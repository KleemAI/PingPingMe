"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Check, ListTodo, Plus, Search, Send, Trash2, UserPlus, X } from "lucide-react";
import { useStore } from "@/lib/client/store";
import type { Task, TaskPerson } from "@/lib/types";
import { REPEAT_LABEL, UNITS, repeatText, type Repeat, type RepeatUnit } from "@/lib/recurrence";
import { byDue, dueText, isOverdue, localDate, planTaskNotifications, repeatLabel, SECTION_TITLE, sectionOf, timeText, tz, type Section } from "@/lib/tasks";
import { Button, Field, Modal, inputCls } from "./ui";
import { ask } from "@/components/Confirm";

type Filter = "all" | "today" | "default" | "given" | string;
const ORDER: Section[] = ["overdue", "today", "tomorrow", "later", "nodate"];
const todayStr = () => localDate(0);

/** ☑ button (next to ⏰) — opens My To-Do; the badge counts new to-dos waiting for your OK + tasks due today / overdue. */
export function TodoButton({ className = "p-2", label }: { className?: string; label?: boolean }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const n = (state?.tasks ?? []).filter((t) => t.audience === "me" && (t.status === "pending" || (!t.done && !!t.dueDate && t.dueDate <= todayStr()))).length;
  return (
    <>
      <button onClick={() => setOpen(true)} title="My To-Do" aria-label={n ? `To-Do, ${n} due` : "To-Do"}
        className={`relative flex items-center gap-1.5 text-[var(--muted)] hover:bg-[var(--hover)] ${label ? "rounded-[14px] text-[12.5px] font-medium" : "rounded-full"} ${className}`}>
        <ListTodo size={17} />{label && <span>To-Do</span>}
        {n > 0 && <span className={`${label ? "" : "absolute -top-0.5 -right-0.5 "}min-w-[16px] rounded-full bg-[var(--accent)] px-1 text-center text-[10px] font-bold leading-4 text-white`}>{n}</span>}
      </button>
      {open && <TodoPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function TodoPanel({ onClose }: { onClose: () => void }) {
  const { state, act, now, toast } = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [edit, setEdit] = useState<Task | "new" | "batch" | null>(null);
  const [newList, setNewList] = useState<string | null>(null);

  const all = state?.tasks ?? [];
  const tasks = useMemo(() => all.filter((t) => t.audience === "me" && t.status !== "pending"), [all]);
  const incoming = useMemo(() => all.filter((t) => t.status === "pending"), [all]);
  const given = state?.assignedTasks ?? [];
  const lists = state?.taskLists ?? [];
  const listName = (id?: string) => (id ? lists.find((l) => l.id === id)?.name ?? "Default" : "Default");
  const isList = filter !== "all" && filter !== "today" && filter !== "default" && filter !== "given";

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = (t: Task) => !needle || `${t.title} ${t.note ?? ""} ${t.ownerName}`.toLowerCase().includes(needle);
    const out: { key: string; title: string; kind: "task" | "pending" | "given"; data: Task[]; count: number }[] = [];
    if (filter === "given") {
      const groups: [string, string, (t: Task) => boolean][] = [
        ["g-wait", "Waiting for OK", (t) => t.status === "pending"],
        ["g-open", "Accepted", (t) => t.status === "accepted" && !t.done],
        ["g-done", "Finished", (t) => t.status === "accepted" && t.done],
        ["g-no", "Declined", (t) => t.status === "declined"],
      ];
      for (const [key, title, f] of groups) {
        const data = given.filter((t) => hit(t) && f(t));
        if (data.length) out.push({ key, title, kind: "given", data, count: data.length });
      }
      return out;
    }
    const inc = incoming.filter(hit);
    if (inc.length) out.push({ key: "incoming", title: "New for you — accept?", kind: "pending", data: inc, count: inc.length });
    const shown = tasks.filter((t) => hit(t) && (filter === "all" || (filter === "today" ? !t.done && !!t.dueDate && t.dueDate <= todayStr() : filter === "default" ? !t.listId : t.listId === filter)));
    for (const s of ORDER) {
      const data = shown.filter((t) => sectionOf(t, now) === s).sort(byDue);
      if (data.length) out.push({ key: s, title: SECTION_TITLE[s], kind: "task", data, count: data.length });
    }
    const done = shown.filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    if (done.length) out.push({ key: "done", title: SECTION_TITLE.done, kind: "task", data: showDone ? done : [], count: done.length });
    return out;
  }, [tasks, incoming, given, filter, q, now, showDone]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return null;

  const toggle = async (t: Task) => {
    const r = (await act("task.done", { id: t.id, done: !t.done }).catch(() => null)) as { next?: string | null } | null;
    if (r?.next) toast(`Done — next on ${dueText({ ...t, dueDate: r.next })}`);
  };
  const respond = (t: Task, accept: boolean) => act("task.respond", { id: t.id, accept }, accept ? "Accepted — it's in your to-do" : "Declined").catch(() => {});
  const takeBack = async (t: Task) => { if (await ask({ title: `Take “${t.title}” back?`, message: `It will be removed from ${t.ownerName}'s list.`, ok: "Take back", danger: true })) act("task.delete", { id: t.id }, "Taken back").catch(() => {}); };
  const addQuick = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    await act("task.save", { title, tzOffset: tz(), listId: isList ? filter : undefined, dueDate: filter === "today" ? todayStr() : undefined }, "Task added").then(() => setQuick("")).catch(() => {});
  };
  const addList = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = (newList ?? "").trim();
    if (!name) return;
    const id = await act("list.save", { name }, "List added").catch(() => null);
    if (typeof id === "string") setFilter(id);
    setNewList(null);
  };
  const deleteList = async () => { if (await ask({ title: `Delete the list “${listName(filter)}”?`, message: "Its tasks move to Default.", ok: "Delete", danger: true })) act("list.delete", { id: filter }, "List deleted").then(() => setFilter("all")).catch(() => {}); };
  const clearDone = async () => { if (await ask({ title: "Delete your completed tasks?", ok: "Delete", danger: true })) act("task.clearDone", {}, "Completed tasks cleared").catch(() => {}); };

  const taskRow = (t: Task) => {
    const late = isOverdue(t, now);
    const meta = [dueText(t), repeatLabel(t) && `🔁 ${repeatLabel(t)}`, t.assignedBy ? `from ${t.assignedByName}` : listName(t.listId)].filter(Boolean).join("  ·  ");
    return (
      <li key={t.id} className="flex items-center gap-3 border-b border-[var(--border)] px-1 py-2.5 last:border-0">
        <button onClick={() => toggle(t)} role="checkbox" aria-checked={t.done} aria-label={t.title}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${t.done ? "border-[var(--muted)] bg-[var(--muted)] text-white" : "border-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"}`}>
          {t.done && <Check size={14} strokeWidth={3} />}
        </button>
        <button onClick={() => setEdit(t)} className="min-w-0 flex-1 text-left">
          <div className={`text-[14.5px] font-medium ${t.done ? "text-[var(--muted)] line-through" : ""}`}>{t.title}</div>
          {meta && <div className={`truncate text-[12px] ${late ? "font-medium text-rose-600" : "text-[var(--muted)]"}`}>{meta}</div>}
        </button>
      </li>
    );
  };
  const pendingRow = (t: Task) => (
    <li key={t.id} className="space-y-2 rounded-[14px] bg-[var(--accent-soft)] p-3">
      <div>
        <div className="text-[14.5px] font-semibold">{t.title}</div>
        {t.note && <p className="whitespace-pre-wrap text-[13px]">{t.note}</p>}
        <div className="text-[12px] text-[var(--muted)]">{[`from ${t.assignedByName}`, dueText(t), repeatLabel(t) && `🔁 ${repeatLabel(t)}`].filter(Boolean).join("  ·  ")}</div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => respond(t, false)}><X size={14} /> Decline</Button>
        <Button size="sm" onClick={() => respond(t, true)}><Check size={14} /> Accept</Button>
      </div>
    </li>
  );
  const givenRow = (t: Task) => {
    const [label, cls] = t.status === "pending" ? ["Waiting", "text-[var(--muted)]"] : t.status === "declined" ? ["Declined", "text-rose-600"] : t.done ? ["Done ✓", "text-[var(--accent-strong)]"] : ["Accepted", "text-[var(--accent-strong)]"];
    return (
      <li key={t.id} className="flex items-center gap-3 border-b border-[var(--border)] px-1 py-2.5 last:border-0">
        <div className="min-w-0 flex-1">
          <div className={`text-[14.5px] font-medium ${t.done ? "line-through" : ""}`}>{t.title}</div>
          <div className="truncate text-[12px] text-[var(--muted)]">{[`to ${t.ownerName}`, dueText(t), t.lastDoneAt && t.repeat !== "none" ? `last done ${new Date(t.lastDoneAt).toLocaleDateString()}` : ""].filter(Boolean).join("  ·  ")}</div>
        </div>
        <span className={`text-[12.5px] font-bold ${cls}`}>{label}</span>
        <button onClick={() => takeBack(t)} title="Take back" aria-label="Take back" className="rounded-full p-1.5 text-rose-600 hover:bg-[var(--hover)]"><Trash2 size={15} /></button>
      </li>
    );
  };

  const count = (id: Filter) => id === "given" ? given.filter((t) => !t.done && t.status !== "declined").length
    : tasks.filter((t) => !t.done && (id === "all" || (id === "today" ? !!t.dueDate && t.dueDate <= todayStr() : id === "default" ? !t.listId : t.listId === id))).length;
  const filters: [Filter, string][] = [["all", "All Lists"], ["today", "Today"], ["default", "Default"], ...lists.map((l) => [l.id, l.name] as [Filter, string]), ["given", "Given by me"]];

  return (
    <>
      <Modal open={!edit} onClose={onClose} title="My To-Do" wide>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="List" className={`${inputCls} w-auto font-medium`}>
              {filters.map(([id, name]) => <option key={id} value={id}>{name}{count(id) ? ` (${count(id)})` : ""}</option>)}
            </select>
            <button onClick={() => setNewList("")} className="rounded-[14px] px-2 py-1.5 text-[13px] text-[var(--accent-strong)] hover:bg-[var(--hover)]">+ New list</button>
            <div className="relative ml-auto min-w-[160px] flex-1 sm:max-w-[220px]">
              <Search size={15} className="absolute left-2.5 top-2.5 text-[var(--muted)]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" className={`${inputCls} pl-8`} />
            </div>
          </div>

          {newList !== null && (
            <form onSubmit={addList} className="flex gap-2 rounded-[14px] border border-[var(--border)] p-2">
              <input autoFocus value={newList} onChange={(e) => setNewList(e.target.value)} maxLength={60} placeholder="Enter List Name" className={inputCls} />
              <Button type="button" variant="ghost" onClick={() => setNewList(null)}>Cancel</Button>
              <Button type="submit" disabled={!newList.trim()}>Add</Button>
            </form>
          )}

          <form onSubmit={addQuick} className="flex gap-2">
            <input value={quick} onChange={(e) => setQuick(e.target.value)} maxLength={200} placeholder="Enter Quick Task Here" className={inputCls} />
            <Button type="submit" disabled={!quick.trim()} aria-label="Add quick task"><Send size={15} /></Button>
            <Button type="button" variant="outline" onClick={() => setEdit("new")}><Plus size={15} /> New task</Button>
            <Button type="button" variant="ghost" onClick={() => setEdit("batch")} title="Add many at once (one per line)">Batch</Button>
          </form>

          {typeof Notification !== "undefined" && Notification.permission === "default" && (
            <button onClick={() => Notification.requestPermission()} className="flex w-full items-center gap-2 rounded-[14px] border border-amber-300 bg-amber-50 px-3 py-2 text-left text-[13px] text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
              <BellRing size={16} /> Allow browser notifications so to-dos also ring when this tab is in the background.
            </button>
          )}

          {!sections.length ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <button onClick={() => setEdit("new")} aria-label="Add first task" className="flex h-20 w-20 items-center justify-center rounded-full border-[3px] border-[var(--accent-strong)] text-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"><Plus size={44} /></button>
              <div className="font-semibold">{q ? "No tasks match your search" : filter === "given" ? "You haven't given a to-do to anyone yet" : "Add First Task"}</div>
              {filter === "given" && <p className="text-[13px] text-[var(--muted)]">In New Task, pick people under “Assign to”.</p>}
            </div>
          ) : sections.map((s) => (
            <section key={s.key}>
              <div className="mb-1 flex items-center gap-2">
                <button disabled={s.key !== "done"} onClick={() => setShowDone((x) => !x)} className={`text-[13px] font-bold ${s.key === "overdue" ? "text-rose-600" : "text-[var(--accent-strong)]"}`}>
                  {s.title} ({s.count}){s.key === "done" ? (showDone ? " ▴" : " ▾") : ""}
                </button>
                {s.key === "done" && showDone && <button onClick={clearDone} className="text-[12px] text-rose-600 hover:underline">Clear</button>}
              </div>
              <ul className={s.kind === "pending" ? "space-y-2" : ""}>{s.data.map((t) => (s.kind === "pending" ? pendingRow(t) : s.kind === "given" ? givenRow(t) : taskRow(t)))}</ul>
            </section>
          ))}
          {isList && <button onClick={deleteList} className="block w-full pt-2 text-center text-[12.5px] text-rose-600 hover:underline">Delete this list</button>}
        </div>
      </Modal>
      {edit === "batch" && <BatchEditor list={isList ? filter : ""} onClose={() => setEdit(null)} />}
      {edit && edit !== "batch" && <TaskEditor task={edit === "new" ? undefined : edit} list={isList ? filter : ""} today={filter === "today"} onClose={() => setEdit(null)} />}
    </>
  );
}

function TaskEditor({ task, list, today, onClose }: { task?: Task; list: string; today: boolean; onClose: () => void }) {
  const { state, act } = useStore();
  const [f, setF] = useState(() => ({
    title: task?.title ?? "", note: task?.note ?? "",
    dueDate: task ? task.dueDate ?? "" : today ? todayStr() : "", dueTime: task?.dueTime ?? "",
    repeat: (task?.repeat ?? "none") as Repeat, repeatEvery: String(task?.repeatEvery ?? 1), repeatUnit: (task?.repeatUnit ?? "day") as RepeatUnit,
    listId: task?.listId ?? list,
  }));
  const me = state?.me.id ?? "";
  const [to, setTo] = useState<string[]>([me]);
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  if (!state) return null;
  const people = state.taskPeople ?? [];
  const lists = state.taskLists ?? [];
  const others = to.filter((x) => x !== me);
  const nameOf = (uid: string) => (uid === me ? "Me" : people.find((p) => p.id === uid)?.name ?? "Someone");
  const toggleTo = (uid: string) => setTo((x) => (x.includes(uid) ? x.filter((y) => y !== uid) : [...x, uid]));
  const matches = who.trim() ? [{ id: me, name: "Me", kind: "team" } as TaskPerson, ...people].filter((p) => p.name.toLowerCase().includes(who.trim().toLowerCase())).slice(0, 8) : [];
  const readOnly = !!task && task.ownerId !== me && state.me.role !== "admin";
  const notification = !f.dueDate ? "No notifications if date not set." : f.dueTime ? `At ${timeText(f.dueTime)} on the day.` : "Day summary on the same day at 8:00 am.";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim() || (!task && !to.length)) return;
    const giving = !task && others.length > 0;
    setBusy(true);
    try {
      await act("task.save", {
        ...(giving ? { assignees: to } : {}),
        id: task?.id, title: f.title.trim(), note: f.note.trim() || undefined, dueDate: f.dueDate || undefined, dueTime: f.dueDate ? f.dueTime || undefined : undefined,
        repeat: f.dueDate ? f.repeat : "none", repeatEvery: Number(f.repeatEvery) || 1, repeatUnit: f.repeatUnit,
        listId: f.listId || undefined, audience: task?.audience ?? "me", tzOffset: tz(),
      }, task ? "Task saved" : giving ? `Sent to ${others.length === 1 ? nameOf(others[0]) : `${others.length} people`} — it starts once they accept` : "Task added");
      onClose();
    } catch { /* toast shown */ } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!task || !(await ask({ title: "Delete this task?", ok: "Delete", danger: true }))) return;
    await act("task.delete", { id: task.id }, "Task deleted").then(onClose).catch(() => {});
  };

  return (
    <Modal open onClose={onClose} title={task ? (readOnly ? "Task" : "Edit Task") : "New Task"}>
      <form onSubmit={save} className="space-y-3.5">
        <Field label="What is to be done?">
          <input autoFocus={!task} value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={200} placeholder="Enter Task Here" disabled={readOnly} className={inputCls} />
        </Field>
        {task?.assignedBy && <p className="text-[12.5px] text-[var(--muted)]">Given to you by {task.assignedByName}.</p>}

        {!task && (
          <Field label="Assign to" hint={others.length ? "They must accept it first. You'll be told when they accept, decline or finish it." : people.length ? (state.scope === "team" ? "Type a name to give it to anyone." : "You can give a to-do to our team.") : undefined}>
            <div className="flex flex-wrap items-center gap-1.5 rounded-[14px] border border-[var(--border-strong)] bg-[var(--input)] p-1.5">
              {to.map((uid) => (
                <button type="button" key={uid} onClick={() => toggleTo(uid)} className="flex items-center gap-1 rounded-full bg-[var(--accent-soft)] py-1 pl-2.5 pr-1.5 text-[13px] font-semibold text-[var(--accent-strong)]">
                  {nameOf(uid)} <X size={12} />
                </button>
              ))}
              <div className="relative min-w-[140px] flex-1">
                <UserPlus size={14} className="absolute left-1.5 top-2 text-[var(--muted)]" />
                <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Add people…" className="w-full bg-transparent py-1 pl-6 text-sm outline-none" />
                {matches.length > 0 && (
                  <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-[14px] border border-[var(--border)] bg-[var(--panel-solid)] shadow-lg">
                    {matches.map((p) => (
                      <li key={p.id}>
                        <button type="button" onClick={() => { toggleTo(p.id); setWho(""); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13.5px] hover:bg-[var(--hover)]">
                          <span className={`flex h-4 w-4 items-center justify-center rounded border ${to.includes(p.id) ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border-strong)]"}`}>{to.includes(p.id) && <Check size={11} strokeWidth={3} />}</span>
                          <span className="flex-1">{p.name}</span>
                          {p.id !== me && <span className="text-[11.5px] text-[var(--muted)]">{p.kind === "team" ? "Team" : p.kind === "reseller" ? "Reseller" : "Customer"}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date">
            <input type="date" value={f.dueDate} onChange={(e) => setF((x) => ({ ...x, dueDate: e.target.value, ...(e.target.value ? {} : { dueTime: "", repeat: "none" as Repeat }) }))} disabled={readOnly} className={inputCls} />
          </Field>
          <Field label="Time (empty = all day)">
            <input type="time" value={f.dueTime} onChange={(e) => set("dueTime", e.target.value)} disabled={readOnly || !f.dueDate} className={inputCls} />
          </Field>
        </div>
        <p className="-mt-1 text-[12.5px] text-[var(--muted)]"><span className="font-semibold text-[var(--accent-strong)]">Notification: </span>{notification}</p>

        {f.dueDate && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Repeat">
              <select value={f.repeat} onChange={(e) => set("repeat", e.target.value as Repeat)} disabled={readOnly} className={inputCls}>
                {(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => <option key={r} value={r}>{REPEAT_LABEL[r]}</option>)}
              </select>
            </Field>
            {f.repeat === "custom" && (
              <>
                <Field label="Every"><input type="number" min={1} max={365} value={f.repeatEvery} onChange={(e) => set("repeatEvery", e.target.value)} className={`${inputCls} w-20`} /></Field>
                <Field label="Unit">
                  <select value={f.repeatUnit} onChange={(e) => set("repeatUnit", e.target.value as RepeatUnit)} className={inputCls}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}{Number(f.repeatEvery) === 1 ? "" : "s"}</option>)}
                  </select>
                </Field>
              </>
            )}
            {f.repeat !== "none" && <span className="pb-2 text-[12.5px] text-[var(--muted)]">{repeatText({ repeat: f.repeat, repeatEvery: Number(f.repeatEvery) || 1, repeatUnit: f.repeatUnit })}</span>}
          </div>
        )}

        {(task ? task.audience === "me" && !task.assignedBy : to.includes(me)) && !readOnly && (
          <Field label={!task && others.length ? "Add to List (your copy)" : "Add to List"}>
            <select value={f.listId} onChange={(e) => set("listId", e.target.value)} className={inputCls}>
              <option value="">Default</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        )}

        <Field label="Note (optional)"><textarea value={f.note} onChange={(e) => set("note", e.target.value)} rows={2} maxLength={2000} disabled={readOnly} className={inputCls} /></Field>

        {!readOnly && (
          <div className="flex items-center gap-2">
            {task && <Button type="button" variant="ghost" className="text-rose-600" onClick={remove}><Trash2 size={15} /> Delete</Button>}
            <Button type="button" variant="ghost" className="ml-auto" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !f.title.trim() || (!task && !to.length)}>{task ? "Save" : others.length ? "Send" : "Add task"}</Button>
          </div>
        )}
      </form>
    </Modal>
  );
}

function BatchEditor({ list, onClose }: { list: string; onClose: () => void }) {
  const { state, act } = useStore();
  const [text, setText] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [listId, setListId] = useState(list);
  const n = text.split(/\r?\n/).filter((l) => l.trim()).length;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!n) return;
    await act("task.batch", { titles: text, dueDate: dueDate || undefined, listId: listId || undefined, tzOffset: tz() }, `${n} task${n > 1 ? "s" : ""} added`).then(onClose).catch(() => {});
  };
  return (
    <Modal open onClose={onClose} title="Add in Batch Mode">
      <form onSubmit={save} className="space-y-3">
        <Field label="What is to be done?" hint="One task per line">
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={"Task 1\nTask 2\nTask 3"} className={inputCls} />
        </Field>
        <Field label="Due date" hint={dueDate ? "Day summary on the same day at 8:00 am." : "No notifications if date not set."}>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Add to List">
          <select value={listId} onChange={(e) => setListId(e.target.value)} className={inputCls}>
            <option value="">Default</option>
            {(state?.taskLists ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!n}>{n ? `Add ${n} task${n > 1 ? "s" : ""}` : "Add tasks"}</Button>
        </div>
      </form>
    </Modal>
  );
}

const RUNG_KEY = "bm-todo-rung";
const SINCE_KEY = "bm-todo-events-since";
const LATE_MS = 10 * 60_000;

/**
 * While the site is open: rings your to-dos at their time (pop-up + browser notification), and tells you when
 * someone gives you a to-do or accepts / declines / finishes one you gave. Rendered once inside StoreProvider.
 */
export function TodoAlerts() {
  const { state, now, toast } = useStore();
  const [ringing, setRinging] = useState<{ id: string; title: string; body: string }[]>([]);
  const rung = useRef<Set<string> | null>(null);
  const notify = (title: string, body: string, tag: string) => {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") { try { new Notification(title, { body, tag }); } catch {} }
  };

  // due to-dos
  useEffect(() => {
    if (!state?.tasks) return;
    if (!rung.current) { try { rung.current = new Set(JSON.parse(localStorage.getItem(RUNG_KEY) ?? "[]")); } catch { rung.current = new Set(); } }
    const due = planTaskNotifications(state.tasks.filter((t) => t.audience === "me"), now - LATE_MS).filter((p) => p.at <= now && !rung.current!.has(p.id));
    if (!due.length) return;
    for (const p of due) { rung.current.add(p.id); notify(p.title, p.body, p.id); }
    try { localStorage.setItem(RUNG_KEY, JSON.stringify([...rung.current].slice(-300))); } catch {}
    setRinging((r) => [...r, ...due.map((p) => ({ id: p.id, title: p.title, body: p.body }))]);
  }, [state?.tasks, now]); // eslint-disable-line react-hooks/exhaustive-deps

  // given to / by you
  useEffect(() => {
    if (!state?.tasks) return;
    const key = `${SINCE_KEY}:${state.me.id}`;
    let since = 0;
    try { since = Number(localStorage.getItem(key)) || 0; } catch {}
    if (!since) { try { localStorage.setItem(key, String(Date.now())); } catch {} return; }
    const events: { at: number; title: string; body: string }[] = [];
    for (const t of state.tasks) if (t.assignedBy && t.status === "pending" && t.createdAt > since) events.push({ at: t.createdAt, title: `📥 New to-do from ${t.assignedByName}`, body: t.title });
    for (const t of state.assignedTasks ?? []) {
      if (t.respondedAt && t.respondedAt > since) events.push({ at: t.respondedAt, title: t.status === "declined" ? `❌ ${t.ownerName} declined` : `👍 ${t.ownerName} accepted`, body: t.title });
      if (t.lastDoneAt && t.lastDoneAt > since) events.push({ at: t.lastDoneAt, title: `✅ ${t.ownerName} finished`, body: t.title });
    }
    if (!events.length) return;
    try { localStorage.setItem(key, String(Math.max(since, ...events.map((e) => e.at)))); } catch {}
    for (const e of events) { toast(`${e.title}: ${e.body}`); notify(e.title, e.body, `todo-${e.at}`); }
  }, [state?.tasks, state?.assignedTasks]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = ringing[0];
  if (!r) return null;
  return (
    <Modal open onClose={() => setRinging((x) => x.slice(1))} title="☑ To-Do">
      <div className="space-y-3">
        <div className="text-[18px] font-bold">{r.title}</div>
        <p className="whitespace-pre-wrap text-[14.5px]">{r.body}</p>
        <Button className="w-full" onClick={() => setRinging((x) => x.slice(1))}>OK</Button>
      </div>
    </Modal>
  );
}
