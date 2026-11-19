import { Injectable } from "@nestjs/common";
import { In, IsNull, Not } from "typeorm";
import type { Broadcast, Task, TaskList, TaskPerson, User } from "../common/contract";
import { badRequest, conflict, forbidden, notFound } from "../common/errors";
import { clean, Payload, newId, oneOf, optStr, str } from "../common/util";
import { isTeam } from "../auth/decorators";
import { TaskEntity, TaskListEntity, UserEntity } from "../database/entities";
import { UnitOfWork, type Tx } from "../database/unit-of-work.service";
import { REPEATS, UNITS, epochOf, isDate, isTime, nextDate, occurrences, todayIn, type RepeatRule } from "./recurrence";

const MAX_OPEN = 500; // open tasks per user
const MAX_LISTS = 30;
const DONE_SHOWN = 100; // completed tasks kept in the app's "Completed" section
const DAY_SUMMARY = "08:00"; // all-day tasks ring at 8:00 on their day
const MAX_ASSIGNEES = 50;
const TEAM_ROLES = ["admin", "agent"];
const kindOf = (role: string): TaskPerson["kind"] => (TEAM_ROLES.includes(role) ? "team" : role === "reseller" ? "reseller" : "customer");

const ruleOf = (t: TaskEntity): RepeatRule => ({ repeat: t.repeat as RepeatRule["repeat"], repeatEvery: t.repeatEvery, repeatUnit: t.repeatUnit as RepeatRule["repeatUnit"], anchorDay: t.anchorDay ?? undefined });

const toTask = (t: TaskEntity): Task => clean({
  id: t.id, ownerId: t.ownerId, ownerName: t.ownerName, audience: t.audience as Task["audience"], title: t.title, note: t.note || undefined,
  listId: t.listId ?? undefined, dueDate: t.dueDate ?? undefined, dueTime: t.dueTime ?? undefined, tzOffset: t.tzOffset,
  repeat: t.repeat as Task["repeat"], repeatEvery: t.repeatEvery, repeatUnit: t.repeatUnit as Task["repeatUnit"], anchorDay: t.anchorDay ?? undefined,
  assignedBy: t.assignedBy ?? undefined, assignedByName: t.assignedByName ?? undefined, status: (t.status || "accepted") as Task["status"],
  respondedAt: t.respondedAt ?? undefined, lastDoneAt: t.lastDoneAt ?? undefined,
  done: t.done, doneAt: t.doneAt ?? undefined, createdAt: t.createdAt, updatedAt: t.updatedAt,
}) as Task;

/**
 * To-do tasks like a phone to-do app: title, due date and time, repeat, lists, batch add.
 * Your own tasks are private; a team member can share a task with everyone (it shows for every user and rings on every phone).
 */
@Injectable()
export class TasksService {
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * Your tasks (open + recent completed, incl. ones given to you that wait for your OK), tasks shared with everyone by the team,
   * your lists, the to-dos you gave to others, and who you can give one to.
   */
  async forUser(user: User): Promise<{ tasks: Task[]; taskLists: TaskList[]; assignedTasks: Task[]; taskPeople: TaskPerson[] }> {
    const em = this.uow.manager;
    const notDeclined = Not("declined");
    const [open, done, shared, lists, given, people] = await Promise.all([
      em.find(TaskEntity, { where: { ownerId: user.id, done: false, status: notDeclined }, order: { createdAt: "ASC" } }),
      em.find(TaskEntity, { where: { ownerId: user.id, done: true, status: notDeclined }, order: { doneAt: "DESC" }, take: DONE_SHOWN }),
      em.find(TaskEntity, { where: { audience: "everyone", done: false, ownerId: Not(user.id) }, order: { createdAt: "ASC" }, take: 200 }),
      em.find(TaskListEntity, { where: { ownerId: user.id }, order: { createdAt: "ASC" } }),
      em.find(TaskEntity, { where: { assignedBy: user.id, ownerId: Not(user.id) }, order: { updatedAt: "DESC" }, take: 200 }),
      em.find(UserEntity, {
        select: { id: true, name: true, role: true },
        where: isTeam(user) ? { active: true, id: Not(user.id) } : { active: true, id: Not(user.id), role: In(TEAM_ROLES) },
        order: { name: "ASC" }, take: 1000,
      }),
    ]);
    return {
      tasks: [...open, ...done, ...shared].map(toTask),
      taskLists: lists.map((l) => ({ id: l.id, name: l.name, createdAt: l.createdAt })),
      assignedTasks: given.map(toTask),
      taskPeople: people.map((u) => ({ id: u.id, name: u.name, kind: kindOf(u.role) })),
    };
  }

  /**
   * Shared tasks with a time also appear as "reminders for everyone" (the web panel and older app versions use those):
   * the next occurrence of each, from a week ago on. All-day ones use 8:00.
   */
  async sharedAsBroadcasts(): Promise<Broadcast[]> {
    const rows = await this.uow.manager.find(TaskEntity, { where: { audience: "everyone", done: false, dueDate: Not(IsNull()) }, take: 200 });
    const now = Date.now();
    const out: Broadcast[] = [];
    for (const t of rows) {
      if (!t.dueDate) continue;
      const from = todayIn(t.tzOffset, now - 7 * 86_400_000);
      for (const date of occurrences(t.dueDate, ruleOf(t), from, 400)) {
        const at = epochOf(date, t.dueTime ?? DAY_SUMMARY, t.tzOffset);
        if (at < now - 7 * 86_400_000) continue;
        if (t.repeat !== "none" && at < now) continue; // repeating: show the next one
        out.push({ id: `task:${t.id}`, title: t.title, message: t.note || undefined, dueAt: at, createdBy: t.ownerId, createdByName: t.ownerName, createdAt: t.createdAt });
        break;
      }
    }
    return out;
  }

  private async own(tx: Tx, id: unknown) {
    const t = await tx.em.findOne(TaskEntity, { where: { id: String(id ?? "") } });
    if (!t) throw notFound("Task");
    if (t.ownerId === tx.user.id) return t;
    if (t.audience === "everyone" && tx.user.role === "admin") return t; // admins can tidy up shared tasks
    throw t.audience === "everyone" ? forbidden("Only the person who shared it (or an admin) can change it") : notFound("Task");
  }

  private async validList(tx: Tx, listId: unknown) {
    if (!listId) return null;
    const l = await tx.em.findOne(TaskListEntity, { where: { id: String(listId), ownerId: tx.user.id } });
    if (!l) throw notFound("List");
    return l.id;
  }

  /** Date, time and repeat fields (shared by save and batch). */
  private when(p: Payload) {
    const dueDate = p.dueDate ? String(p.dueDate) : null;
    if (dueDate && !isDate(dueDate)) throw badRequest("Pick a valid date");
    const dueTime = p.dueTime ? String(p.dueTime) : null;
    if (dueTime && !isTime(dueTime)) throw badRequest("Pick a valid time");
    if (dueTime && !dueDate) throw badRequest("Pick a date for the time");
    const repeat = p.repeat ? oneOf(p.repeat, REPEATS, "repeat") : "none";
    if (repeat !== "none" && !dueDate) throw badRequest("Pick a start date for a repeating task");
    const repeatEvery = repeat === "custom" ? Math.floor(Number(p.repeatEvery ?? 1)) : 1;
    if (repeat === "custom" && !(repeatEvery >= 1 && repeatEvery <= 365)) throw badRequest("Repeat every 1–365");
    const repeatUnit = repeat === "custom" ? oneOf(p.repeatUnit ?? "day", UNITS, "repeat unit") : "day";
    const tz = Number(p.tzOffset ?? -330);
    const tzOffset = Number.isInteger(tz) && tz >= -840 && tz <= 840 ? tz : -330;
    const anchorDay = dueDate && repeat !== "none" ? Number(dueDate.slice(8, 10)) : null;
    return { dueDate, dueTime, repeat, repeatEvery, repeatUnit, tzOffset, anchorDay };
  }

  /** task.save { id?, title, note?, dueDate?, dueTime?, repeat?, repeatEvery?, repeatUnit?, listId?, audience?, tzOffset } */
  async save(tx: Tx, p: Payload) {
    const audience = p.audience ? oneOf(p.audience, ["me", "everyone"] as const, "who it's for") : "me";
    if (audience === "everyone" && !isTeam(tx.user)) throw forbidden("Only our team can share tasks with everyone");
    const fields = {
      title: str(p.title, "What is to be done?", 200), note: optStr(p.note, 2000) ?? "",
      listId: audience === "everyone" ? null : await this.validList(tx, p.listId), audience, ...this.when(p),
    };
    const now = Date.now();
    if (!p.id && Array.isArray(p.assignees) && p.assignees.length) return this.give(tx, p, fields, now);
    if (p.id) {
      const t = await this.own(tx, p.id);
      if (t.ownerId !== tx.user.id) fields.listId = t.listId; // an admin editing someone's shared task keeps their list
      Object.assign(t, fields, { updatedAt: now });
      await tx.em.save(t);
      return t.id;
    }
    if ((await tx.em.count(TaskEntity, { where: { ownerId: tx.user.id, done: false } })) >= MAX_OPEN) throw conflict(`You have ${MAX_OPEN} open tasks — finish or delete some first`);
    const id = newId("tk");
    await tx.em.insert(TaskEntity, { id, ownerId: tx.user.id, ownerName: tx.user.name, ...fields, done: false, doneAt: null, createdAt: now, updatedAt: now });
    return id;
  }

  /**
   * task.save { …, assignees: [userId…] } — give the to-do to one or more people (you can include yourself).
   * Each gets their own copy that waits for them to accept it. Team → anyone; resellers and customers → our team only.
   */
  private async give(tx: Tx, p: Payload, fields: Record<string, unknown>, now: number) {
    if (fields.audience === "everyone") throw badRequest("Pick people or everyone, not both");
    const ids = [...new Set((p.assignees as unknown[]).map(String))];
    if (ids.length > MAX_ASSIGNEES) throw badRequest(`Up to ${MAX_ASSIGNEES} people at a time`);
    const others = ids.filter((id) => id !== tx.user.id);
    const users = others.length ? await tx.em.find(UserEntity, { where: { id: In(others), active: true } }) : [];
    if (users.length !== others.length) throw notFound("Person");
    if (!isTeam(tx.user) && users.some((u) => !TEAM_ROLES.includes(u.role))) throw forbidden("You can give a to-do to our team only");
    const out: string[] = [];
    if (ids.includes(tx.user.id)) {
      const id = newId("tk");
      await tx.em.insert(TaskEntity, { id, ownerId: tx.user.id, ownerName: tx.user.name, ...fields, done: false, doneAt: null, createdAt: now, updatedAt: now });
      out.push(id);
    }
    for (const u of users) {
      if ((await tx.em.count(TaskEntity, { where: { ownerId: u.id, done: false } })) >= MAX_OPEN) throw conflict(`${u.name} has too many open tasks`);
      const id = newId("tk");
      await tx.em.insert(TaskEntity, {
        id, ownerId: u.id, ownerName: u.name, ...fields, listId: null, audience: "me",
        assignedBy: tx.user.id, assignedByName: tx.user.name, status: "pending", done: false, doneAt: null, createdAt: now, updatedAt: now,
      });
      out.push(id);
    }
    return out;
  }

  /** task.respond { id, accept } — accept or decline a to-do someone gave you. */
  async respond(tx: Tx, p: Payload) {
    const t = await tx.em.findOne(TaskEntity, { where: { id: String(p.id ?? ""), ownerId: tx.user.id } });
    if (!t) throw notFound("Task");
    if (t.status !== "pending") throw conflict(t.status === "accepted" ? "Already accepted" : "Already declined");
    t.status = p.accept === false ? "declined" : "accepted";
    t.respondedAt = t.updatedAt = Date.now();
    await tx.em.save(t);
    return t.status;
  }

  /** task.batch { titles: string[] | "line 1\nline 2", dueDate?, listId?, tzOffset } — "Add in batch mode" (own tasks). */
  async batch(tx: Tx, p: Payload) {
    const raw = Array.isArray(p.titles) ? p.titles.map(String) : String(p.titles ?? "").split(/\r?\n/);
    const titles = raw.map((s) => s.trim()).filter(Boolean);
    if (!titles.length) throw badRequest("Write one task per line");
    if (titles.length > 50) throw badRequest("Up to 50 tasks at a time");
    if (titles.some((t) => t.length > 200)) throw badRequest("Keep each task under 200 characters");
    const { dueDate, tzOffset } = this.when({ dueDate: p.dueDate, tzOffset: p.tzOffset });
    const listId = await this.validList(tx, p.listId);
    const open = await tx.em.count(TaskEntity, { where: { ownerId: tx.user.id, done: false } });
    if (open + titles.length > MAX_OPEN) throw conflict(`You can have up to ${MAX_OPEN} open tasks`);
    const now = Date.now();
    const ids: string[] = [];
    for (const [i, title] of titles.entries()) {
      const id = newId("tk");
      ids.push(id);
      await tx.em.insert(TaskEntity, {
        id, ownerId: tx.user.id, ownerName: tx.user.name, audience: "me", title, note: "", listId, dueDate, dueTime: null, tzOffset, anchorDay: null,
        repeat: "none", repeatEvery: 1, repeatUnit: "day", done: false, doneAt: null, createdAt: now + i, updatedAt: now + i,
      });
    }
    return ids;
  }

  /** task.done { id, done } — a repeating task moves to its next date instead of closing. */
  async done(tx: Tx, p: Payload) {
    const t = await this.own(tx, p.id);
    const done = p.done !== false;
    const now = Date.now();
    if (t.status === "pending") throw conflict("Accept this to-do first");
    if (done) t.lastDoneAt = now;
    if (done && t.repeat !== "none" && t.dueDate) {
      t.dueDate = nextDate(t.dueDate, ruleOf(t)) ?? t.dueDate;
      t.updatedAt = now;
      await tx.em.save(t);
      return { next: t.dueDate };
    }
    t.done = done;
    t.doneAt = done ? now : null;
    t.updatedAt = now;
    await tx.em.save(t);
    return { next: null };
  }

  /** task.delete { id } */
  async remove(tx: Tx, p: Payload) {
    const given = await tx.em.findOne(TaskEntity, { where: { id: String(p.id ?? ""), assignedBy: tx.user.id } });
    const t = given && given.ownerId !== tx.user.id ? given : await this.own(tx, p.id); // the giver can take it back
    await tx.em.delete(TaskEntity, { id: t.id });
  }

  /** task.clearDone — delete your completed tasks. */
  async clearDone(tx: Tx) {
    await tx.em.delete(TaskEntity, { ownerId: tx.user.id, done: true });
  }

  /** list.save { id?, name } */
  async saveList(tx: Tx, p: Payload) {
    const name = str(p.name, "List name", 60);
    const taken = await tx.em.findOne(TaskListEntity, { where: { ownerId: tx.user.id, name } });
    if (taken && taken.id !== p.id) throw conflict("You already have a list with this name");
    if (p.id) {
      const l = await tx.em.findOne(TaskListEntity, { where: { id: String(p.id), ownerId: tx.user.id } });
      if (!l) throw notFound("List");
      l.name = name;
      await tx.em.save(l);
      return l.id;
    }
    if ((await tx.em.count(TaskListEntity, { where: { ownerId: tx.user.id } })) >= MAX_LISTS) throw conflict(`Up to ${MAX_LISTS} lists`);
    const id = newId("tl");
    await tx.em.insert(TaskListEntity, { id, ownerId: tx.user.id, name, createdAt: Date.now() });
    return id;
  }

  /** list.delete { id } — its tasks move to Default. */
  async deleteList(tx: Tx, p: Payload) {
    const l = await tx.em.findOne(TaskListEntity, { where: { id: String(p.id ?? ""), ownerId: tx.user.id } });
    if (!l) throw notFound("List");
    await tx.em.update(TaskEntity, { ownerId: tx.user.id, listId: l.id }, { listId: null });
    await tx.em.delete(TaskListEntity, { id: l.id });
  }
}

