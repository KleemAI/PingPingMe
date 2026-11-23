import { Platform, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { caseOverdue } from "@/lib/format";
import { AppearanceCard, Avatar, Badge, Card, Row, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import { StorageCard } from "@/components/StorageCard";
import { confirm } from "@/components/Confirm";

export default function More() {
  const { c } = useTheme();
  const { db, me, now, server, logout, state } = useTeam();
  const chev = <Ionicons name="chevron-forward" size={16} color={c.muted} />;
  const openCases = db.cases.filter((x) => x.status !== "resolved").length;
  const overdue = db.cases.filter((x) => caseOverdue(x, now)).length;
  const pendingResellers = db.resellers.filter((r) => r.status === "pending").length;
  const unverified = (db.customers ?? []).filter((u) => !u.verified).length;
  const proposals = (db.products ?? []).filter((p) => p.status === "pending").length;
  const icon = (name: keyof typeof Ionicons.glyphMap, bg: string) => (
    <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}><Ionicons name={name} size={18} color="#fff" /></View>
  );
  const signOut = () => {
    confirm({ title: "Sign out?", message: "You can sign in again any time.", ok: "Sign out", danger: true, icon: "log-out-outline" }).then((ok) => { if (ok) logout(); });
  };

  return (
    <ScrollPad>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
          <Avatar name={me.name} size={54} />
          <View style={{ flex: 1 }}>
            <T weight="700" size={17}>{me.name}</T>
            <T muted size={13}>{me.role === "admin" ? "Owner / admin" : "Operations agent"} · {me.email}</T>
            <T muted size={12}>{db.settings.business.name}</T>
          </View>
        </View>
      </Card>
      <Card>
        <Row left={icon("storefront", "#0284c7")} title="Resellers" subtitle={`${db.resellers.filter((r) => r.status === "active").length} active${pendingResellers ? ` · ${pendingResellers} awaiting approval` : ""}`} right={chev} onPress={() => router.push("/reseller")} />
        <Row left={icon("scale", "#e11d48")} title="Mediation & support" subtitle={`${openCases} open${overdue ? ` · ${overdue} overdue` : ""}`} right={<View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><Badge n={openCases} />{chev}</View>} onPress={() => router.push("/case")} />
        <Row left={icon("person-add", "#7c3aed")} title="Customers" subtitle={unverified ? `${unverified} waiting for verification` : `${(db.customers ?? []).length} signed up`} right={<View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><Badge n={unverified} />{chev}</View>} onPress={() => router.push("/customers")} />
        <Row left={icon("bag-handle", "#ea580c")} title="Catalog" subtitle={proposals ? `${proposals} reseller proposal${proposals > 1 ? "s" : ""} to review` : `${(db.products ?? []).filter((p) => p.status === "approved" && p.active).length} live products`} right={<View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><Badge n={proposals} />{chev}</View>} onPress={() => router.push("/catalog")} />
        <Row left={icon("checkbox", "#16a34a")} title="My To-Do" subtitle="Your own tasks, with date, time and repeat" right={chev} onPress={() => router.push("/todo")} />
        <Row left={icon("alarm", "#2563eb")} title="Reminders for everyone" subtitle={`${(state?.broadcasts ?? []).filter((b) => b.dueAt > now).length} upcoming · rings on every phone`} right={chev} onPress={() => router.push("/reminders")} />
        <Row left={icon("swap-horizontal", "#2f7fe0")} title="P2P market" subtitle="Buy & sell between users · appeals" right={chev} onPress={() => router.push("/p2p")} />
      </Card>
      <StorageCard />
      <AppearanceCard />
      <Card title="Saved replies" icon="flash-outline">
        {db.savedReplies.map((s) => <Row key={s.id} title={`/${s.shortcut}`} subtitle={s.text} />)}
        <T muted size={12} style={{ padding: 12 }}>Type “/” in any message box to use these. Manage them in the web app → Settings.</T>
      </Card>
      <Card title="Linked devices" icon="phone-portrait-outline">
        <Row title="Linked devices" subtitle="Phones and browsers signed in to your account" onPress={() => router.push("/devices")} />
      </Card>
      <Card title="Connection" icon="cloud-outline">
        <Row title="Server" subtitle={server || "same origin"} />
        <Row title="Channels" subtitle={db.settings.channels.map((ch) => `${ch.name}: ${ch.status.replace("_", " ")}`).join("\n")} />
      </Card>
      <Card>
        <Row left={icon("log-out-outline", "#64748b")} title="Sign out" onPress={signOut} />
      </Card>
      <T muted size={12} style={{ textAlign: "center" }}>Team settings, roles and exports are managed in the web app.</T>
    </ScrollPad>
  );
}
