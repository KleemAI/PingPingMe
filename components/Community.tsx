"use client";

import { useState } from "react";
import { Check, Loader2, LogOut, Megaphone, Pencil, Plus, X } from "lucide-react";
import { useStore } from "@/lib/client/store";
import type { Community, GroupChat } from "@/lib/types";
import { Avatar, Button, Modal, inputCls } from "./ui";

/** Groups you run that aren't in a community yet — the ones you can bring into one. */
const freeGroups = (groups: GroupChat[]) => groups.filter((g) => g.admin && !g.communityId && !g.announcement);

function GroupTicks({ groups, picked, setPicked }: { groups: GroupChat[]; picked: string[]; setPicked: (ids: string[]) => void }) {
  if (!groups.length) return <p className="rounded-[14px] bg-[var(--panel-2)] px-3 py-2 text-[12.5px] text-[var(--muted)]">No groups to add — you can add groups you&apos;re an admin of and that aren&apos;t in a community.</p>;
  return (
    <ul className="scroll-thin max-h-56 divide-y divide-[var(--border)] overflow-y-auto rounded-[20px] border border-[var(--border)] bg-[var(--panel)]">
      {groups.map((g) => {
        const on = picked.includes(g.id);
        return (
          <li key={g.id}>
            <button type="button" onClick={() => setPicked(on ? picked.filter((x) => x !== g.id) : [...picked, g.id])} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--hover)]">
              <Avatar name={g.name} size={34} group />
              <div className="min-w-0 flex-1"><div className="truncate text-[14px]">{g.name}</div><div className="text-[12px] text-[var(--muted)]">{g.members.length} members</div></div>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${on ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border-strong)]"}`}>{on && <Check size={13} />}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** New community: a name, a description and the groups to bring in. */
export function NewCommunity({ groups, onClose, onCreated }: { groups: GroupChat[]; onClose: () => void; onCreated: (id: string) => void }) {
  const { act } = useStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="New community">
      <div className="space-y-3">
        <p className="text-[12.5px] text-[var(--muted)]">A community brings related groups together. Everyone in its groups gets an <b>Announcements</b> group where only community admins post.</p>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Community name" aria-label="Community name" />
        <textarea className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} placeholder="What's it about? (optional)" aria-label="Description" />
        <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">Add groups</div>
        <GroupTicks groups={freeGroups(groups)} picked={picked} setPicked={setPicked} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim() || busy} onClick={async () => {
            setBusy(true);
            try { onCreated((await act("community.create", { name: name.trim(), description: description.trim() || undefined, groupIds: picked }, "Community created")) as string); } catch { /* toast */ } finally { setBusy(false); }
          }}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Megaphone size={15} />} Create community</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Community page: its groups (open the ones you're in), and for admins: edit, add/remove groups. */
export function CommunityInfo({ community: c, groups, onClose, onOpenGroup, reload }: {
  community: Community; groups: GroupChat[]; onClose: () => void; onOpenGroup: (id: string) => void; reload: () => Promise<void>;
}) {
  const { act } = useStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description ?? "");
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const run = (type: string, payload: Record<string, unknown>, ok?: string) => act(type, { communityId: c.id, ...payload }, ok).then(reload);
  return (
    <Modal open onClose={onClose} title="Community">
      <div className="space-y-4">
        {editing ? (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run("community.update", { name: name.trim(), description: description.trim() }, "Saved").then(() => setEditing(false)).catch(() => {}); }}>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus aria-label="Community name" />
            <textarea className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} aria-label="Description" />
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button><Button size="sm" disabled={!name.trim()}>Save</Button></div>
          </form>
        ) : (
          <div className="flex items-center gap-3">
            <Avatar name={c.name} size={52} community />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[17px] font-semibold">{c.name}
                {c.admin && <button onClick={() => setEditing(true)} title="Edit" className="text-[var(--muted)]"><Pencil size={14} /></button>}</div>
              <div className="text-[12.5px] text-[var(--muted)]">Community · {c.memberCount} members{c.admin ? " · You're an admin" : ""}</div>
              {c.description && <p className="mt-1 whitespace-pre-wrap text-[13px]">{c.description}</p>}
            </div>
          </div>
        )}

        <ul className="scroll-thin max-h-72 divide-y divide-[var(--border)] overflow-y-auto rounded-[20px] border border-[var(--border)] bg-[var(--panel)]">
          {c.groups.map((g) => (
            <li key={g.id} className="flex items-center gap-3 px-3 py-2">
              {g.announcement ? <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]"><Megaphone size={16} /></span> : <Avatar name={g.name} size={34} group />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px]">{g.announcement ? "Announcements" : g.name}</div>
                <div className="text-[12px] text-[var(--muted)]">{g.memberCount} members{g.announcement ? " · only admins post" : g.member ? "" : " · ask its admin to add you"}</div>
              </div>
              {g.member && <Button size="sm" variant="outline" onClick={() => onOpenGroup(g.id)}>Open</Button>}
              {c.admin && !g.announcement && (
                <Button size="sm" variant="ghost" title="Remove from community" onClick={() => confirm(`Remove "${g.name}" from the community? The group itself stays.`) && run("community.removeGroup", { groupId: g.id }, "Group removed").catch(() => {})}><X size={14} /></Button>
              )}
            </li>
          ))}
        </ul>

        {c.admin && (adding ? (
          <div className="glass space-y-2 rounded-[20px] p-3">
            <GroupTicks groups={freeGroups(groups)} picked={picked} setPicked={setPicked} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setPicked([]); }}>Cancel</Button>
              <Button size="sm" disabled={!picked.length} onClick={async () => {
                try { for (const groupId of picked) await act("community.addGroup", { communityId: c.id, groupId }); } catch { /* toast */ }
                await reload(); setAdding(false); setPicked([]);
              }}><Plus size={14} /> Add {picked.length || ""}</Button>
            </div>
          </div>
        ) : <Button variant="outline" size="sm" onClick={() => setAdding(true)}><Plus size={14} /> Add groups</Button>)}

        <div className="flex justify-between">
          <Button variant="danger" size="sm" onClick={() => { if (confirm(`Leave "${c.name}"? You'll leave all its groups.`)) act("community.leave", { communityId: c.id }, "You left the community").then(reload).then(onClose).catch(() => {}); }}><LogOut size={14} /> Leave community</Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
