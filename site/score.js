// Gauge — capacity model. Shared by the report page (browser) and the tests (Node).
// "You are using X% of your Sales Navigator capacity": the average of up to nine levers, each 0–100%.
// Levers with no reading are left out of the average and listed as "not read".
// A lever is only suggested as a move when it is below its target (70% is "well filled").
// Targets and limits are Claude's first proposal (2026-11-14), not yet confirmed by Olivier.

export const LIMITS = { inmailPerMonth: 50, invitesPerWeek: 100, savedLeads: 10000, savedAccounts: 10000, groups: 100 };

const pct = (x) => Math.max(0, Math.min(100, Math.round(x * 100)));

export const LEVERS = [
  {
    id: 'inmail', group: 'fill', name: 'InMail credits', target: 70,
    read: (s) => (s.salesnav?.inmailLeft == null ? null : pct(1 - s.salesnav.inmailLeft / LIMITS.inmailPerMonth)),
    detail: (s) => `${s.salesnav.inmailLeft} left of about ${LIMITS.inmailPerMonth} a month`,
    move: 'Spend your InMail credits every month',
    why: 'Unused credits expire. Send them to saved leads who have not accepted an invitation.',
  },
  {
    id: 'invites', group: 'fill', name: 'Connection invitations', target: 70,
    read: (s) => (s.invitations?.read ? pct(s.invitations.under1w / LIMITS.invitesPerWeek) : null),
    detail: (s) => `About ${s.invitations.under1w} sent in the last week, against a ${LIMITS.invitesPerWeek}-a-week pace`,
    move: 'Send about 100 invitations a week',
    why: 'A steady pace keeps new conversations coming without tripping LinkedIn limits.',
  },
  {
    id: 'savedAccounts', group: 'fill', name: 'Saved accounts', target: 70,
    read: (s) => (s.salesnav?.savedAccounts == null ? null : pct(s.salesnav.savedAccounts / LIMITS.savedAccounts)),
    detail: (s) => `${fmt(s.salesnav.savedAccounts)} of ${fmt(LIMITS.savedAccounts)}`,
    move: 'Save the accounts you target',
    why: 'Saved accounts feed alerts and account lists, which is where Sales Navigator earns its price.',
  },
  {
    id: 'savedLeads', group: 'fill', name: 'Saved leads', target: 70,
    read: (s) => (s.salesnav?.savedLeads == null ? null : pct(s.salesnav.savedLeads / LIMITS.savedLeads)),
    detail: (s) => `${fmt(s.salesnav.savedLeads)} of ${fmt(LIMITS.savedLeads)}`,
    move: 'Save the decision-makers you want to reach',
    why: 'Saved leads unlock job-change and post alerts, your best reasons to write.',
  },
  {
    id: 'groups', group: 'fill', name: 'Groups joined', target: 70,
    read: (s) => (s.groups?.joined == null ? null : pct(s.groups.joined / LIMITS.groups)),
    detail: (s) => `${fmt(s.groups.joined)} of the ${LIMITS.groups} LinkedIn allows`,
    move: 'Join the groups your buyers are in',
    why: 'Group members can be found and messaged through the group. Each empty slot is an audience you are not reaching.',
  },
  {
    id: 'find', group: 'work', name: 'Finding the right people', target: 70,
    read: (s) => (s.ssi?.find == null ? null : pct(s.ssi.find / 25)),
    detail: (s) => `SSI part: ${s.ssi.find} of 25`,
    move: 'Open your saved searches every Monday',
    why: 'New results pile up unread. A weekly pass lifts "Find the right people".',
  },
  {
    id: 'engage', group: 'work', name: 'Engaging with insights', target: 60,
    read: (s) => (s.ssi?.engage == null ? null : pct(s.ssi.engage / 25)),
    detail: (s) => `SSI part: ${s.ssi.engage} of 25`,
    move: "Comment on five prospects' posts a week",
    why: 'Comments on prospects’ posts are what LinkedIn counts as engaging with insights.',
  },
  {
    id: 'lists', group: 'work', name: 'Lists kept alive', target: 50,
    read: (s) => {
      const l = listsTotal(s);
      return l && l.lists ? pct(l.updated30d / l.lists) : null;
    },
    detail: (s) => {
      const l = listsTotal(s);
      return `${l.updated30d} of ${l.lists} lists updated in the last 30 days`;
    },
    move: 'Work half of your lists each month',
    why: 'Archive the dead lists and keep a handful live. Lists you never open are capacity you pay for and do not use.',
  },
  {
    // Bonus lever: only Page admins have a reading; for everyone else it is left out of the average.
    // Proxy (Claude's proposal 2026-11-17): invitations sent in a month (last week × 4) against the
    // unique visitors your company Page had in 30 days. Visitor names are never read.
    id: 'pageVisitors', group: 'work', name: 'Page visitors worked', target: 70,
    read: (s) => {
      const v = s.page?.visitors30d;
      if (!v || !s.invitations?.read) return null;
      return pct((s.invitations.under1w * 4) / v);
    },
    detail: (s) => `About ${s.invitations.under1w * 4} invitations a month for ${fmt(s.page.visitors30d)} Page visitors in 30 days`,
    move: 'Follow up on the people who visit your Page',
    why: 'Page visitors already know you. Find them in Sales Navigator and invite the ones who fit, every week.',
  },
];

function listsTotal(s) {
  const p = s.lists?.people;
  const c = s.lists?.company;
  if (!p && !c) return null;
  return { lists: (p?.lists || 0) + (c?.lists || 0), updated30d: (p?.updated30d || 0) + (c?.updated30d || 0) };
}

function fmt(n) {
  return Number(n).toLocaleString('en-US');
}

const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export function gradeFor(score) {
  if (score == null) return null;
  const bands = [['A', 85], ['B', 70], ['C', 55], ['D', 40]];
  for (const [g, min] of bands) if (score >= min) return g === 'A' || score < min + 10 ? g : g + '+';
  return 'F';
}

// Averages and the top-3 moves from lever values (shared by the report and the /app dashboard).
function summarize(levers) {
  const got = levers.filter((l) => l.value != null);
  const overall = avg(got.map((l) => l.value));
  const fill = avg(got.filter((l) => l.group === 'fill').map((l) => l.value));
  const work = avg(got.filter((l) => l.group === 'work').map((l) => l.value));
  const n = got.length;
  const moves = got
    .filter((l) => l.value < l.target)
    .map((l) => {
      const def = LEVERS.find((d) => d.id === l.id);
      return { id: l.id, gain: Math.round((l.target - l.value) / n), title: def.move, why: def.why, from: l.value, to: l.target };
    })
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 3);
  const after = overall == null ? null : Math.min(100, overall + moves.reduce((a, m) => a + m.gain, 0));
  return { overall, fill, work, moves, after };
}

// Rebuild levers and moves from saved lever percentages ({ inmail: 0, lists: 7, … }), as stored per test.
export function fromLevers(values) {
  const v = values || {};
  const levers = LEVERS.map((l) => {
    const x = v[l.id];
    return { id: l.id, group: l.group, name: l.name, value: Number.isInteger(x) && x >= 0 && x <= 100 ? x : null, target: l.target };
  });
  const r = summarize(levers);
  return { ...r, grade: gradeFor(r.overall), afterGrade: gradeFor(r.after), levers };
}

export function computeGrade(signals) {
  const s = signals || {};
  const levers = LEVERS.map((l) => {
    const value = l.read(s);
    return { id: l.id, group: l.group, name: l.name, value, detail: value == null ? null : l.detail(s), target: l.target };
  });
  const { overall, fill, work, moves, after } = summarize(levers);

  const inv = s.invitations;
  const kpis = {
    engagementsPer1000:
      s.content?.impressions && s.content?.engagements != null ? Math.round((s.content.engagements / s.content.impressions) * 10000) / 10 : null,
    oldInvitesShare: inv?.read ? pct(inv.w2plus / inv.read) : null,
    pendingInvites: inv?.pending ?? null,
    impressionsPerFollower:
      s.content?.impressions && s.dashboard?.followers ? Math.round((s.content.impressions / s.dashboard.followers) * 10) / 10 : null,
    profileViewers: s.dashboard?.profileViewers ?? null,
    searchAppearances: s.dashboard?.searchAppearances ?? null,
  };

  return {
    overall, fill, work, grade: gradeFor(overall), levers, moves, after, afterGrade: gradeFor(after), kpis,
    ssi: s.ssi || null,
    notRead: levers.filter((l) => l.value == null).map((l) => l.name),
  };
}

// Signals travel from the extension to the report page in the URL fragment (never sent to a server).
export function encodeSignals(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeSignals(str) {
  try {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
