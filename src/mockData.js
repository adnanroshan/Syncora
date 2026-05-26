/* Syncora — mock data for `vite dev` only.
   In production this file is bundled but only used when window.$app
   is not available (i.e. you're running outside CodeOnTime). */

const users = [
  { userid: 1, username: 'mira.chen',    name: 'Mira Chen',     hue: 165 },
  { userid: 2, username: 'jules.okafor', name: 'Jules Okafor',  hue: 28  },
  { userid: 3, username: 'aria.singh',   name: 'Aria Singh',    hue: 280 },
  { userid: 4, username: 'tomas.berg',   name: 'Tomas Berg',    hue: 210 },
  { userid: 5, username: 'nia.rivers',   name: 'Nia Rivers',    hue: 340 },
  { userid: 6, username: 'dev.patel',    name: 'Dev Patel',     hue: 50  },
  { userid: 7, username: 'sasha.ito',    name: 'Sasha Ito',     hue: 130 },
  { userid: 8, username: 'me',           name: 'You',           hue: 165, isMe: true },
];

const orgs = [
  { id: 1, organisationid: 1, name: 'Northwind Health',  short: 'NW' },
  { id: 2, organisationid: 2, name: 'Helix Robotics',    short: 'HR' },
  { id: 3, organisationid: 3, name: 'Larkfield Bank',    short: 'LB' },
  { id: 4, organisationid: 4, name: 'Cobalt Logistics',  short: 'CL' },
  { id: 5, organisationid: 5, name: 'Vesper Studios',    short: 'VS' },
  { id: 6, organisationid: 6, name: 'Internal',          short: '·'  },
];

const products = [
  { id: 1, productid: 1, orgId: 1, name: 'Patient Portal'      },
  { id: 2, productid: 2, orgId: 1, name: 'Clinician Tablet'    },
  { id: 3, productid: 3, orgId: 2, name: 'FleetOps Cloud'      },
  { id: 4, productid: 4, orgId: 3, name: 'Retail Banking App'  },
  { id: 5, productid: 5, orgId: 4, name: 'Dispatcher Console'  },
  { id: 6, productid: 6, orgId: 5, name: 'Stream Editor'       },
  { id: 7, productid: 7, orgId: 6, name: 'Syncora Platform'    },
];

const modules = [
  { id: 1,  moduleid: 1,  productid: 1, name: 'Auth & SSO'      },
  { id: 2,  moduleid: 2,  productid: 1, name: 'Records'         },
  { id: 3,  moduleid: 3,  productid: 1, name: 'Billing'         },
  { id: 4,  moduleid: 4,  productid: 2, name: 'Charting'        },
  { id: 5,  moduleid: 5,  productid: 2, name: 'Offline Sync'    },
  { id: 6,  moduleid: 6,  productid: 3, name: 'Telemetry'       },
  { id: 7,  moduleid: 7,  productid: 3, name: 'Maintenance'     },
  { id: 8,  moduleid: 8,  productid: 4, name: 'Transfers'       },
  { id: 9,  moduleid: 9,  productid: 4, name: 'Notifications'   },
  { id: 10, moduleid: 10, productid: 5, name: 'Routing'         },
  { id: 11, moduleid: 11, productid: 5, name: 'Driver App'      },
  { id: 12, moduleid: 12, productid: 6, name: 'Timeline'        },
  { id: 13, moduleid: 13, productid: 6, name: 'Export'          },
  { id: 14, moduleid: 14, productid: 7, name: 'Billing & Plans' },
  { id: 15, moduleid: 15, productid: 7, name: 'Onboarding'      },
];

const taskgroups = [
  { id: 1, taskgroupid: 1, name: 'Sprint 24.W21' },
  { id: 2, taskgroupid: 2, name: 'Backlog' },
  { id: 3, taskgroupid: 3, name: 'Customer Reports' },
  { id: 4, taskgroupid: 4, name: 'Infra & Platform' },
  { id: 5, taskgroupid: 5, name: 'Design Polish' },
];

const today = new Date(); today.setHours(0,0,0,0);
const day = (offset) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d.toISOString();
};

const rawTasks = [
  { title: 'SSO callback returns 500 when org has SAML enabled',
    desc:  'Reproduced on staging with Northwind tenant. Stack trace shows missing claim mapping. Need to add fallback to email when nameid is absent.',
    status: 'inprogress', priority: 'urgent', due: day(0),
    groupId: 1, orgId: 1, productId: 1, moduleId: 1, userId: 1 },
  { title: 'Patient records search ignores accented characters',
    desc:  'Customer-reported. Search for "Müller" returns no results, but "Muller" does. Likely needs ICU collation on the index.',
    status: 'todo', priority: 'high', due: day(2),
    groupId: 3, orgId: 1, productId: 1, moduleId: 2, userId: 8 },
  { title: 'Add CSV export to billing reconciliation report',
    desc:  'Requested by Northwind finance team. Match the column order from their existing spreadsheet template (attached in ticket).',
    status: 'todo', priority: 'medium', due: day(5),
    groupId: 1, orgId: 1, productId: 1, moduleId: 3, userId: 2 },
  { title: 'Offline sync conflict resolution loses chart annotations',
    desc:  'When two clinicians edit the same chart offline, the merge picks the latest by mtime but drops annotation layers. Need a three-way merge.',
    status: 'blocked', priority: 'urgent', due: day(-2),
    groupId: 1, orgId: 1, productId: 2, moduleId: 5, userId: 3 },
  { title: 'Tablet app crashes on iPad mini 6 when rotating',
    desc:  'Crash happens during the orientation animation. Looks like a layout constraint conflict in the charting canvas.',
    status: 'inprogress', priority: 'high', due: day(1),
    groupId: 3, orgId: 1, productId: 2, moduleId: 4, userId: 4 },
  { title: 'Fleet telemetry dashboard slow on 90-day range',
    desc:  'P99 query time is 14s. Profile shows the aggregation runs on raw rows instead of the hourly rollup.',
    status: 'todo', priority: 'high', due: day(3),
    groupId: 1, orgId: 2, productId: 3, moduleId: 6, userId: 5 },
  { title: 'Predictive maintenance alerts firing too often for cohort 7',
    desc:  'False positive rate is ~30%. Need to retune the threshold or add a confirmation window before alerting.',
    status: 'todo', priority: 'medium', due: day(7),
    groupId: 1, orgId: 2, productId: 3, moduleId: 7, userId: 5 },
  { title: 'Add bulk vehicle import via CSV',
    desc:  null,
    status: 'todo', priority: 'low', due: day(14),
    groupId: 2, orgId: 2, productId: 3, moduleId: 6, userId: null },
  { title: 'ACH transfer screen — show estimated arrival date',
    desc:  'Larkfield wants users to see "Arrives Wed, May 22" instead of just a generic 1-3 business days.',
    status: 'inprogress', priority: 'medium', due: day(4),
    groupId: 1, orgId: 3, productId: 4, moduleId: 8, userId: 6 },
  { title: 'Push notification opt-in modal blocks new users',
    desc:  'Onboarding completion dropped 12% after the modal change. Should be dismissable without granting permission.',
    status: 'done', priority: 'high', due: day(-1),
    groupId: 1, orgId: 3, productId: 4, moduleId: 9, userId: 6 },
  { title: 'Dispatcher console — drag-to-assign loses keyboard focus',
    desc:  'Accessibility audit flag. After dropping an order onto a driver, focus returns to body instead of the dropped element.',
    status: 'todo', priority: 'medium', due: day(6),
    groupId: 5, orgId: 4, productId: 5, moduleId: 10, userId: 7 },
  { title: 'Driver app: offline route caching uses too much storage',
    desc:  'Average storage per driver climbed to 480MB. Need a sliding-window cache that drops segments older than 7 days.',
    status: 'inprogress', priority: 'high', due: day(2),
    groupId: 1, orgId: 4, productId: 5, moduleId: 11, userId: 1 },
  { title: 'Add per-route ETA confidence band',
    desc:  null,
    status: 'todo', priority: 'low', due: day(21),
    groupId: 2, orgId: 4, productId: 5, moduleId: 10, userId: null },
  { title: 'Timeline scrubber jumps when zooming past 2× ',
    desc:  'Vesper editors report the playhead snaps to the nearest second when zoom > 2x, making frame-accurate edits impossible.',
    status: 'inprogress', priority: 'urgent', due: day(0),
    groupId: 3, orgId: 5, productId: 6, moduleId: 12, userId: 2 },
  { title: 'H.265 export fails silently on macOS 14.4',
    desc:  null,
    status: 'blocked', priority: 'high', due: day(-3),
    groupId: 3, orgId: 5, productId: 6, moduleId: 13, userId: 3 },
  { title: 'Reduce cold-start time of preview renderer',
    desc:  'Currently 4.2s on M2 Pro. Target is sub-1.5s. Suspect we are loading codec table eagerly.',
    status: 'todo', priority: 'medium', due: day(10),
    groupId: 1, orgId: 5, productId: 6, moduleId: 12, userId: 4 },
  { title: 'Syncora — annual plan checkout shows wrong tax for EU',
    desc:  'VAT line item is calculated on net but displayed as if applied on gross. Customer-visible bug.',
    status: 'todo', priority: 'urgent', due: day(1),
    groupId: 1, orgId: 6, productId: 7, moduleId: 14, userId: 8 },
  { title: 'New workspace onboarding — invite teammates step skippable',
    desc:  'Make it skippable but track skip-rate so we can A/B test reordering.',
    status: 'done', priority: 'medium', due: day(-5),
    groupId: 1, orgId: 6, productId: 7, moduleId: 15, userId: 6 },
  { title: 'Audit log retention setting per workspace',
    desc:  null,
    status: 'todo', priority: 'low', due: day(30),
    groupId: 2, orgId: 6, productId: 7, moduleId: 14, userId: null },
  { title: 'Dark mode review across all surfaces',
    desc:  'Several pills and badges have poor contrast in dark mode. Need a pass before launch.',
    status: 'inprogress', priority: 'medium', due: day(8),
    groupId: 5, orgId: 6, productId: 7, moduleId: null, userId: 7 },
  { title: 'Empty state illustrations for board view',
    desc:  null,
    status: 'todo', priority: 'low', due: null,
    groupId: 5, orgId: 6, productId: 7, moduleId: null, userId: null },
  { title: 'Sentry alert routing per product team',
    desc:  'Route Northwind errors to #patientportal, Helix to #fleetops, etc. Use the productid tag.',
    status: 'done', priority: 'medium', due: day(-7),
    groupId: 4, orgId: 6, productId: 7, moduleId: null, userId: 1 },
  { title: 'Migrate Postgres 14 → 16 on staging',
    desc:  null,
    status: 'inprogress', priority: 'high', due: day(3),
    groupId: 4, orgId: 6, productId: 7, moduleId: null, userId: 4 },
  { title: 'CDN cache key includes auth header (causes misses)',
    desc:  'Vary header is wrong. Strip Authorization from cache key for public endpoints.',
    status: 'todo', priority: 'high', due: day(2),
    groupId: 4, orgId: 6, productId: 7, moduleId: null, userId: 4 },
  { title: 'Investigate flaky integration test — patientPortal/sso.spec',
    desc:  'Fails ~1 in 20 on CI but never locally. Probably timing-dependent on the IdP mock.',
    status: 'todo', priority: 'medium', due: day(5),
    groupId: 4, orgId: 1, productId: 1, moduleId: 1, userId: 8 },
  { title: 'Improve "no due date" copy on task rows',
    desc:  null,
    status: 'done', priority: 'low', due: day(-10),
    groupId: 5, orgId: 6, productId: 7, moduleId: null, userId: 8 },
];

const tasks = rawTasks.map((t, i) => {
  const created  = new Date(today); created.setDate(created.getDate() - (40 - i));
  const modified = new Date(created); modified.setDate(modified.getDate() + (i % 10));
  const org  = orgs.find(o => o.id === t.orgId);
  const prod = products.find(p => p.id === t.productId);
  const mod  = t.moduleId ? modules.find(m => m.id === t.moduleId) : null;
  const grp  = taskgroups.find(g => g.id === t.groupId);
  const user = t.userId ? users.find(u => u.userid === t.userId) : null;
  return {
    taskid:           1000 + i,
    title:            t.title,
    description:      t.desc,
    status:           t.status,
    priority:         t.priority,
    duedate:          t.due,
    creationdate:     created.toISOString(),
    lastmodifieddate: modified.toISOString(),
    taskgroupid:      t.groupId,
    taskgroupname:    grp?.name,
    organisationid:   t.orgId,
    organisationname: org?.name,
    productid:        t.productId,
    productname:      prod?.name,
    moduleid:         t.moduleId,
    modulename:       mod?.name,
    createdbyuserid:  user?.userid ?? null,
    assignee:         user || null,
    orgShort:         org?.short,
  };
});

/* Per-user access tables for the mock `me` user (userid=8).
 * Gates the Client picker (userOrgs) and the Product / Module pickers
 * (userProductsModules) the same way the real backend does. */
const userOrgs = [
  { userid: 8, organisationid: 1, isprimary: true,  organisationName: 'Northwind Health' },
  { userid: 8, organisationid: 3, isprimary: false, organisationName: 'Larkfield Bank'   },
  { userid: 8, organisationid: 6, isprimary: false, organisationName: 'Internal'         },

  /* Cross-user access — drives the assignee eligibility picker.
   * Each user that historically created a task in an org gets access
   * to that org so they remain assignable; a few extras are added so
   * the picker shows realistic alternatives. */
  { userid: 1, organisationid: 1 }, { userid: 1, organisationid: 4 }, { userid: 1, organisationid: 6 },
  { userid: 2, organisationid: 1 }, { userid: 2, organisationid: 5 }, { userid: 2, organisationid: 6 },
  { userid: 3, organisationid: 1 }, { userid: 3, organisationid: 5 },
  { userid: 4, organisationid: 1 }, { userid: 4, organisationid: 5 }, { userid: 4, organisationid: 6 },
  { userid: 5, organisationid: 2 },
  { userid: 6, organisationid: 3 }, { userid: 6, organisationid: 6 },
  { userid: 7, organisationid: 4 }, { userid: 7, organisationid: 6 },
];

const userProductsModules = [
  // Patient Portal (product 1) — full access to all three modules
  { userid: 8, productid: 1, moduleid: 1, canread: true, canwrite: true,  candelete: false, productname: 'Patient Portal',    modulename: 'Auth & SSO' },
  { userid: 8, productid: 1, moduleid: 2, canread: true, canwrite: true,  candelete: false, productname: 'Patient Portal',    modulename: 'Records'    },
  { userid: 8, productid: 1, moduleid: 3, canread: true, canwrite: true,  candelete: false, productname: 'Patient Portal',    modulename: 'Billing'    },
  // Clinician Tablet (product 2) — only Charting is writable
  { userid: 8, productid: 2, moduleid: 4, canread: true, canwrite: true,  candelete: false, productname: 'Clinician Tablet',  modulename: 'Charting'   },
  // Retail Banking App (product 4) — write access to Transfers
  { userid: 8, productid: 4, moduleid: 8, canread: true, canwrite: true,  candelete: false, productname: 'Retail Banking App', modulename: 'Transfers'  },

  /* Cross-user access. canread=true on every row so the picker (which
   * gates on "any access") includes them; canwrite varies to mirror
   * real ACL spread. */
  { userid: 1, productid: 1, moduleid: 1, canread: true, canwrite: true  },
  { userid: 1, productid: 5, moduleid: 11, canread: true, canwrite: true },
  { userid: 2, productid: 1, moduleid: 3, canread: true, canwrite: true  },
  { userid: 2, productid: 6, moduleid: 12, canread: true, canwrite: false },
  { userid: 2, productid: 7, moduleid: 14, canread: true, canwrite: true },
  { userid: 3, productid: 2, moduleid: 5, canread: true, canwrite: true  },
  { userid: 3, productid: 6, moduleid: 13, canread: true, canwrite: true },
  { userid: 4, productid: 2, moduleid: 4, canread: true, canwrite: true  },
  { userid: 4, productid: 6, moduleid: 12, canread: true, canwrite: false },
  { userid: 4, productid: 7, moduleid: 14, canread: true, canwrite: true },
  { userid: 5, productid: 3, moduleid: 6, canread: true, canwrite: true  },
  { userid: 5, productid: 3, moduleid: 7, canread: true, canwrite: true  },
  { userid: 6, productid: 4, moduleid: 8, canread: true, canwrite: true  },
  { userid: 6, productid: 4, moduleid: 9, canread: true, canwrite: true  },
  { userid: 6, productid: 7, moduleid: 15, canread: true, canwrite: true },
  { userid: 7, productid: 5, moduleid: 10, canread: true, canwrite: true },
  { userid: 7, productid: 7, moduleid: 14, canread: true, canwrite: false },
];

/* A couple of pre-seeded assignees so the panel doesn't always look empty. */
const taskAssignees = [
  { taskid: 1000, assigneduserid: 1, isprimary: true  },
  { taskid: 1000, assigneduserid: 8, isprimary: false },
  { taskid: 1004, assigneduserid: 4, isprimary: true  },
];

/* ----- Activity & Discussion seeds (scoped to task 1000 for demo) ----- */
const minsAgo  = (m) => new Date(Date.now() - m * 60_000).toISOString();
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const daysAgoIso = (d) => new Date(Date.now() - d * 86400_000).toISOString();

const taskActivity = [
  { activityid: 1, taskid: 1000, userid: 1, userUsername: 'mira.chen',
    activitytype: 'Task Created', creationdate: daysAgoIso(3) },
  { activityid: 2, taskid: 1000, userid: 1, userUsername: 'mira.chen',
    activitytype: 'Priority Changed', fieldname: 'priority',
    oldvalue: 'medium', newvalue: 'high', creationdate: daysAgoIso(3) },
  { activityid: 3, taskid: 1000, userid: 1, userUsername: 'mira.chen',
    activitytype: 'Assignee Added', fieldname: 'assigneduserid',
    newvalue: 8, creationdate: daysAgoIso(3) },
  { activityid: 4, taskid: 1000, userid: 8, userUsername: 'me',
    activitytype: 'Status Changed', fieldname: 'status',
    oldvalue: 'todo', newvalue: 'inprogress', creationdate: daysAgoIso(2) },
  { activityid: 5, taskid: 1000, userid: 8, userUsername: 'me',
    activitytype: 'Subtask Added', fieldname: 'subtask',
    newvalue: 'Reproduce on staging', creationdate: daysAgoIso(2) },
  { activityid: 6, taskid: 1000, userid: 8, userUsername: 'me',
    activitytype: 'Subtask Completed', fieldname: 'subtask',
    newvalue: 'Reproduce on staging', creationdate: daysAgoIso(1) },
  { activityid: 7, taskid: 1000, userid: 1, userUsername: 'mira.chen',
    activitytype: 'Due Date Extended', fieldname: 'duedate',
    oldvalue: '5/26/2026', newvalue: '5/27/2026', creationdate: hoursAgo(4) },
  { activityid: 8, taskid: 1000, userid: 8, userUsername: 'me',
    activitytype: 'Description Changed', fieldname: 'description',
    creationdate: hoursAgo(2) },
];

const taskMessages = [
  { messageid: 1, taskid: 1000, parentmessageid: null,
    userid: 1, userUsername: 'mira.chen',
    messagetext: 'Picked this up — going to repro on staging first. Will post findings.',
    isedited: false, editeddate: null, isdeleted: false, deleteddate: null,
    creationdate: daysAgoIso(2) },
  { messageid: 2, taskid: 1000, parentmessageid: 1,
    userid: 8, userUsername: 'me',
    messagetext: "Cool, ping me when you have the HAR — I have a hunch it's in ClaimMapper.",
    isedited: false, editeddate: null, isdeleted: false, deleteddate: null,
    creationdate: daysAgoIso(2) },
  { messageid: 3, taskid: 1000, parentmessageid: 1,
    userid: 1, userUsername: 'mira.chen',
    messagetext: "Repro'd. HAR attached. @me your hunch was right.",
    isedited: false, editeddate: null, isdeleted: false, deleteddate: null,
    creationdate: hoursAgo(20) },
  { messageid: 4, taskid: 1000, parentmessageid: null,
    userid: 3, userUsername: 'aria.singh',
    messagetext: "Audit log says NPE in ClaimMapper.map() when SAML has no `nameid`. Going to try defaulting to `email`.",
    isedited: false, editeddate: null, isdeleted: false, deleteddate: null,
    creationdate: hoursAgo(6) },
  { messageid: 5, taskid: 1000, parentmessageid: null,
    userid: 8, userUsername: 'me',
    messagetext: 'wrong thread, sorry',
    isedited: false, editeddate: null,
    isdeleted: true, deleteddate: hoursAgo(5),
    creationdate: hoursAgo(5) },
  { messageid: 6, taskid: 1000, parentmessageid: null,
    userid: 1, userUsername: 'mira.chen',
    messagetext: "@aria.singh confirmed — defaulting to email works for new tenants but breaks the ones we provisioned manually. PR up: #4421.",
    isedited: true, editeddate: hoursAgo(1),
    isdeleted: false, deleteddate: null,
    creationdate: hoursAgo(2) },
  { messageid: 7, taskid: 1000, parentmessageid: 6,
    userid: 3, userUsername: 'aria.singh',
    messagetext: 'Reviewing now 👀',
    isedited: false, editeddate: null, isdeleted: false, deleteddate: null,
    creationdate: hoursAgo(1) },
  { messageid: 8, taskid: 1000, parentmessageid: null,
    userid: 3, userUsername: 'aria.singh',
    messagetext: "Bringing this up in @mira.chen's standup tomorrow.",
    isedited: false, editeddate: null, isdeleted: false, deleteddate: null,
    creationdate: minsAgo(30) },
  { messageid: 9, taskid: 1000, parentmessageid: null,
    userid: 1, userUsername: 'mira.chen',
    messagetext: 'Sounds good. @jules.okafor can you join too?',
    isedited: false, editeddate: null, isdeleted: false, deleteddate: null,
    creationdate: minsAgo(12) },
];

const taskMessageReactions = [
  { messageid: 4, userid: 1, emoji: '👍', creationdate: hoursAgo(5) },
  { messageid: 4, userid: 8, emoji: '👍', creationdate: hoursAgo(5) },
  { messageid: 4, userid: 1, emoji: '🧠', creationdate: hoursAgo(5) },
  { messageid: 6, userid: 3, emoji: '🎉', creationdate: hoursAgo(1) },
  { messageid: 6, userid: 8, emoji: '🎉', creationdate: hoursAgo(1) },
  { messageid: 7, userid: 1, emoji: '✅', creationdate: minsAgo(50) },
];

const taskMessageMentions = [
  { messageid: 3, userid: 8, creationdate: hoursAgo(20) },
  { messageid: 6, userid: 3, creationdate: hoursAgo(2) },
  { messageid: 8, userid: 1, creationdate: minsAgo(30) },
  { messageid: 9, userid: 2, creationdate: minsAgo(12) },
];

const taskMessageReads = [
  { taskid: 1000, userid: 8, lastreadmessageid: 6, lastreaddate: hoursAgo(1) },
];

export const SEED = {
  users, orgs, products, modules, taskgroups, tasks,
  userOrgs, userProductsModules, taskAssignees,
  taskActivity, taskMessages, taskMessageReactions, taskMessageMentions, taskMessageReads,
};
