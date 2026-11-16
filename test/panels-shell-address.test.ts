import { describe, expect, it } from 'vitest';
import {
  type CompanyRoute,
  companyHref,
  companyPath,
  type MainView,
  openSub,
  type PanelView,
  parseAddress,
  parseCompanyAddress,
  routePath,
  type TabbedRoute,
} from '../web/src/company/address.ts';
import { baseName, insideOf, joinPath, parentOf, sameFolder } from '../web/src/company/paths.ts';

describe('addresses', () => {
  it('reads the lobby, Start and a company, its route in the new form', () => {
    expect(parseAddress('/')).toEqual({ kind: 'lobby' });
    expect(parseAddress('/new')).toEqual({ kind: 'new' });
    const office = { main: { kind: 'office' }, panel: null };
    expect(parseAddress('/c/plant-pal')).toEqual({ kind: 'company', company: 'plant-pal', route: office, old: false, talk: null });
    expect(parseAddress('/c/plant-pal/')).toEqual({ kind: 'company', company: 'plant-pal', route: office, old: false, talk: null });
    expect(parseAddress('/c/plant-pal/org', '?panel=people/kai')).toMatchObject({ route: { main: { kind: 'org' }, panel: { kind: 'person', person: 'kai' } }, old: false });
    expect(parseAddress('/c/plant-pal/inbox')).toMatchObject({ route: office, old: true });
    expect(parseAddress('/c/plant-pal/inbox', '', '#q-3')).toMatchObject({ route: { main: { kind: 'office' }, panel: { kind: 'inbox', item: 'q-3' } }, old: true });
  });

  it('sends an unknown address to the lobby or the company, never to an error', () => {
    expect(parseAddress('/somewhere/else')).toEqual({ kind: 'lobby' });
    expect(parseAddress('/c')).toEqual({ kind: 'lobby' });
    expect(parseAddress('/c/%E0%A4%A')).toEqual({ kind: 'lobby' });
    expect(parseAddress('/c/plant-pal/no-such-view')).toMatchObject({ kind: 'company', company: 'plant-pal', route: { main: { kind: 'office' }, panel: null } });
    expect(parseAddress('/new/more')).toEqual({ kind: 'lobby' });
  });

  it('decodes ids and writes them back encoded', () => {
    expect(parseAddress('/c/caf%C3%A9', '?panel=people/kai%20b')).toMatchObject({ company: 'café', route: { panel: { kind: 'person', person: 'kai b' } } });
    expect(companyPath('café', 'people/kai')).toBe('/c/caf%C3%A9/people/kai');
    expect(companyPath('plant-pal')).toBe('/c/plant-pal');
    expect(companyPath('plant-pal', '/inbox')).toBe('/c/plant-pal/inbox');
    expect(routePath({ view: 'people', person: 'kai', compose: true })).toBe('people/kai/message');
    expect(routePath({ view: 'tasks', task: 't 1', diff: true })).toBe('tasks/t%201/diff');
    expect(routePath({ view: 'now' })).toBe('');
  });

  it("writes today's views as the old sub-paths openSub reads", () => {
    const trips: [string, TabbedRoute][] = [
      ['plan', { view: 'plan', version: null }],
      ['plan/v3', { view: 'plan', version: 3 }],
      ['messages/m-12', { view: 'message', message: 'm-12' }],
      ['messages/grp%201', { view: 'message', message: 'grp 1' }],
      ['decisions', { view: 'decisions', decision: null }],
      ['decisions/d-4', { view: 'decisions', decision: 'd-4' }],
      ['send/room/design', { view: 'send', to: ['room', 'design'] }],
      ['inbox/q-3', { view: 'inbox', item: 'q-3' }],
      ['proposal', { view: 'proposal' }],
      ['preview', { view: 'preview' }],
    ];
    for (const [path, route] of trips) expect(routePath(route)).toBe(path);
  });
});

/** A company's address as the address bar has it, read: its path, its query and its hash. */
function read(address: string) {
  const url = new URL(address, 'http://127.0.0.1');
  return parseCompanyAddress(url.pathname, url.search, url.hash);
}

/** The new form of where an address leads: what the shell puts in place of an old one. */
function newForm(address: string): string | null {
  const found = read(address);
  return found ? companyHref(found.company, found.route) : null;
}

const MAIN_VIEWS: [string, MainView][] = [
  ['/c/cafe', { kind: 'office' }],
  ['/c/cafe/progress', { kind: 'progress' }],
  ['/c/cafe/org', { kind: 'org' }],
  ['/c/cafe/tasks', { kind: 'tasks' }],
  ['/c/cafe/plan', { kind: 'plan', version: null }],
  ['/c/cafe/plan/v2', { kind: 'plan', version: 2 }],
  ['/c/cafe/dashboards', { kind: 'dashboards', board: null }],
  ['/c/cafe/dashboards/spend', { kind: 'dashboards', board: 'spend' }],
  ['/c/cafe/dashboards/timeline', { kind: 'dashboards', board: 'timeline' }],
  ['/c/cafe/dashboards/dash-2', { kind: 'dashboards', board: 'dash-2' }],
  ['/c/cafe/decisions', { kind: 'decisions' }],
  ['/c/cafe/preview', { kind: 'preview' }],
  ['/c/cafe/tasks/t-12/diff', { kind: 'diff', task: 't-12' }],
];

const PANEL_VIEWS: [string, PanelView | null][] = [
  ['', null],
  ['?panel=inbox/q-3', { kind: 'inbox', item: 'q-3' }],
  ['?panel=people/kai', { kind: 'person', person: 'kai' }],
  ['?panel=tasks/t-12', { kind: 'task', task: 't-12' }],
  ['?panel=tasks/new', { kind: 'new-task' }],
  ['?panel=messages/m-12', { kind: 'message', message: 'm-12' }],
  ['?panel=decisions/d-4', { kind: 'decision', decision: 'd-4' }],
  ['?panel=customize', { kind: 'customize' }],
  ['?panel=settings', { kind: 'settings' }],
  ['?panel=proposal', { kind: 'proposal' }],
];

describe("the stage and dock's addresses", () => {
  it('writes and reads every main view with every side panel view beside it', () => {
    for (const [path, main] of MAIN_VIEWS) {
      for (const [query, panel] of PANEL_VIEWS) {
        const route: CompanyRoute = { main, panel };
        expect(companyHref('cafe', route)).toBe(`${path}${query}`);
        expect(read(`${path}${query}`)).toEqual({ company: 'cafe', route, old: false, talk: null });
      }
    }
  });

  it("encodes ids, keeps the side panel's slash readable, and reads both back", () => {
    const route: CompanyRoute = { main: { kind: 'diff', task: 't 1/a' }, panel: { kind: 'person', person: 'kai b&c=d#e+f%g/h' } };
    const href = companyHref('café', route);
    expect(href).toBe('/c/caf%C3%A9/tasks/t%201%2Fa/diff?panel=people/kai%20b%26c%3Dd%23e%2Bf%25g%2Fh');
    expect(read(href)).toEqual({ company: 'café', route, old: false, talk: null });
    const board: CompanyRoute = { main: { kind: 'dashboards', board: 'Übersicht' }, panel: { kind: 'message', message: 'grp 1' } };
    expect(read(companyHref('cafe', board))?.route).toEqual(board);
  });

  it('reads the side panel as URLSearchParams writes it, as taking the token out of the address leaves it', () => {
    expect(read('/c/cafe?panel=people%2Fkai')?.route.panel).toEqual({ kind: 'person', person: 'kai' });
    expect(read('/c/cafe?panel=messages%2Fgrp+1')?.route.panel).toEqual({ kind: 'message', message: 'grp 1' });
    const query = new URLSearchParams({ panel: 'tasks/t-12' }).toString();
    expect(read(`/c/cafe/tasks?${query}`)?.route).toEqual({ main: { kind: 'tasks' }, panel: { kind: 'task', task: 't-12' } });
  });

  it("shows the side panel's home for a ?panel= that names nothing, whatever else the query holds", () => {
    const nothing = ['nobody', 'people', 'people/', '/people/kai', 'inbox', 'tasks', 'customize/x', 'settings/', `people/${'k'.repeat(201)}`, 'people/%E0%A4%A', 'decisions/%FF'];
    for (const value of nothing) expect(read(`/c/cafe?panel=${value}`)?.route, value).toEqual({ main: { kind: 'office' }, panel: null });
    expect(read(`/c/cafe?panel=people/${'k'.repeat(200)}`)?.route.panel).toEqual({ kind: 'person', person: 'k'.repeat(200) });
    expect(read('/c/cafe?token=abc&panel=people/kai&demo')?.route.panel).toEqual({ kind: 'person', person: 'kai' });
    expect(read('/c/cafe?panel=people/kai&panel=people/mina')?.route.panel).toEqual({ kind: 'person', person: 'kai' });
  });

  it("opens on the office for a path it doesn't know, and on an older plan or a board only by a name that can be one", () => {
    expect(read('/c/cafe/no-such-view')?.route.main).toEqual({ kind: 'office' });
    expect(read('/c/cafe/org/more')?.route.main).toEqual({ kind: 'org' });
    for (const version of ['3', 'v0', 'v1234567', 'vx']) expect(read(`/c/cafe/plan/${version}`)?.route.main, version).toEqual({ kind: 'plan', version: null });
    expect(read('/c/cafe/dashboards/%E0%A4%A')?.route.main).toEqual({ kind: 'dashboards', board: null });
    expect(read('/c/cafe/tasks/%E0%A4%A/diff')?.route.main).toEqual({ kind: 'tasks' });
  });

  it('reads no company outside /c/:company', () => {
    for (const path of ['/', '/new', '/c', '/c/', '/c/%E0%A4%A', '/somewhere/else', `/c/${'c'.repeat(201)}`]) expect(read(path), path).toBeNull();
  });
});

describe('progress (v0.2)', () => {
  it('is a main view of its own at progress, beside any side panel view, while the bare company stays the office', () => {
    expect(read('/c/cafe/progress')).toEqual({ company: 'cafe', route: { main: { kind: 'progress' }, panel: null }, old: false, talk: null });
    expect(read('/c/cafe/progress?panel=inbox/q-3')).toMatchObject({ route: { main: { kind: 'progress' }, panel: { kind: 'inbox', item: 'q-3' } } });
    expect(companyHref('cafe', { main: { kind: 'progress' }, panel: { kind: 'task', task: 't-12' } })).toBe('/c/cafe/progress?panel=tasks/t-12');
    expect(companyPath('cafe', 'progress')).toBe('/c/cafe/progress');
    expect(read('/c/cafe')).toMatchObject({ route: { main: { kind: 'office' }, panel: null } });
  });

  it('opens from inside the office as every main view does, the side panel kept on desktops', () => {
    const here: CompanyRoute = { main: { kind: 'office' }, panel: { kind: 'person', person: 'kai' } };
    expect(openSub(here, 'progress', true)).toEqual({ route: { main: { kind: 'progress' }, panel: { kind: 'person', person: 'kai' } }, talk: null });
    expect(openSub(here, 'progress', false)).toEqual({ route: { main: { kind: 'progress' }, panel: null }, talk: null });
  });
});

describe('old addresses', () => {
  it('reads each one as its new form, which takes its place', () => {
    const OLD: [string, string][] = [
      ['/c/cafe/inbox', '/c/cafe'],
      ['/c/cafe/inbox/q-3', '/c/cafe?panel=inbox/q-3'],
      // As the Answer links write it.
      ['/c/cafe/inbox#q-3', '/c/cafe?panel=inbox/q-3'],
      ['/c/cafe/people', '/c/cafe/org'],
      ['/c/cafe/people/kai', '/c/cafe?panel=people/kai'],
      ['/c/cafe/people/kai/message', '/c/cafe?panel=people/kai'],
      ['/c/cafe/tasks/t-12', '/c/cafe/tasks?panel=tasks/t-12'],
      ['/c/cafe/messages/m-12', '/c/cafe?panel=messages/m-12'],
      ['/c/cafe/decisions/d-4', '/c/cafe/decisions?panel=decisions/d-4'],
      ['/c/cafe/send', '/c/cafe'],
      ['/c/cafe/send/everyone', '/c/cafe'],
      ['/c/cafe/send/room/design', '/c/cafe'],
      ['/c/cafe/customize', '/c/cafe?panel=customize'],
      ['/c/cafe/settings', '/c/cafe?panel=settings'],
      ['/c/cafe/proposal', '/c/cafe'],
    ];
    for (const [old, now] of OLD) {
      expect(read(old)?.old, old).toBe(true);
      expect(newForm(old), old).toBe(now);
    }
  });

  it('keeps what an old address asked the talk bar for, which no address holds: its To, with focus in its box', () => {
    const talk = (address: string) => read(address)?.talk;
    expect(talk('/c/cafe/people/kai/message')).toEqual({ to: { kind: 'person', id: 'kai' } });
    expect(talk('/c/cafe/send')).toEqual({ to: null });
    expect(talk('/c/cafe/send/everyone')).toEqual({ to: { kind: 'everyone' } });
    expect(talk('/c/cafe/send/room/design')).toEqual({ to: { kind: 'room', id: 'design' } });
    expect(talk('/c/cafe/send/team/head-of-design')).toEqual({ to: { kind: 'team', head: 'head-of-design' } });
    expect(talk('/c/cafe/send/person/kai%20b')).toEqual({ to: { kind: 'person', id: 'kai b' } });
    // A composer's address that names nobody still asks for the talk bar, with its To as it is.
    for (const nobody of ['send/room', 'send/nobody/kai', 'send/person/%E0%A4%A']) expect(talk(`/c/cafe/${nobody}`), nobody).toEqual({ to: null });
    for (const quiet of ['/c/cafe/people/kai', '/c/cafe/inbox', '/c/cafe', '/c/cafe/tasks']) expect(talk(quiet), quiet).toBeNull();
  });

  it('leaves the view an old address sat under when its id names nothing', () => {
    const cases: [string, string][] = [
      ['/c/cafe/inbox/%E0%A4%A', '/c/cafe'],
      ['/c/cafe/people/%E0%A4%A', '/c/cafe/org'],
      ['/c/cafe/tasks/%E0%A4%A', '/c/cafe/tasks'],
      ['/c/cafe/decisions/%E0%A4%A', '/c/cafe/decisions'],
      ['/c/cafe/messages', '/c/cafe'],
      ['/c/cafe/messages/%E0%A4%A', '/c/cafe'],
    ];
    for (const [old, now] of cases) {
      expect(read(old)?.old, old).toBe(true);
      expect(newForm(old), old).toBe(now);
    }
  });

  it('takes an address both forms share as it is, and an old path over a ?panel= beside it', () => {
    for (const path of ['/c/cafe', '/c/cafe/tasks', '/c/cafe/plan', '/c/cafe/plan/v2', '/c/cafe/dashboards/spend', '/c/cafe/decisions', '/c/cafe/preview', '/c/cafe/tasks/t-12/diff']) {
      expect(read(path)?.old, path).toBe(false);
    }
    expect(read('/c/cafe/people/kai?panel=settings')).toEqual({ company: 'cafe', route: { main: { kind: 'office' }, panel: { kind: 'person', person: 'kai' } }, old: true, talk: null });
  });
});

describe('links inside the office, from the route shown', () => {
  const office: CompanyRoute = { main: { kind: 'office' }, panel: null };
  const kaiOnTasks: CompanyRoute = { main: { kind: 'tasks' }, panel: { kind: 'person', person: 'kai' } };
  const open = (here: CompanyRoute, sub: string, keepPanel = true) => openSub(here, sub, keepPanel);

  it('opens a side panel view over the main view shown, whatever main view its old address sat under', () => {
    expect(open(kaiOnTasks, 'people/mina').route).toEqual({ main: { kind: 'tasks' }, panel: { kind: 'person', person: 'mina' } });
    expect(open(office, 'tasks/t-12').route).toEqual({ main: { kind: 'office' }, panel: { kind: 'task', task: 't-12' } });
    expect(open(kaiOnTasks, 'inbox#q-3').route).toEqual({ main: { kind: 'tasks' }, panel: { kind: 'inbox', item: 'q-3' } });
    expect(open(kaiOnTasks, 'inbox').route).toEqual({ main: { kind: 'tasks' }, panel: null });
    expect(open(office, 'decisions/d-4').route).toEqual({ main: { kind: 'office' }, panel: { kind: 'decision', decision: 'd-4' } });
    for (const view of ['customize', 'settings'] as const) expect(open(kaiOnTasks, view).route).toEqual({ main: { kind: 'tasks' }, panel: { kind: view } });
  });

  it("opens a main view with the side panel's view kept on desktops and dropped on phones", () => {
    expect(open(kaiOnTasks, 'dashboards/spend').route).toEqual({ main: { kind: 'dashboards', board: 'spend' }, panel: { kind: 'person', person: 'kai' } });
    expect(open(kaiOnTasks, 'dashboards/spend', false).route).toEqual({ main: { kind: 'dashboards', board: 'spend' }, panel: null });
    expect(open(kaiOnTasks, 'people').route).toEqual({ main: { kind: 'org' }, panel: { kind: 'person', person: 'kai' } });
    expect(open(kaiOnTasks, '').route).toEqual({ main: { kind: 'office' }, panel: { kind: 'person', person: 'kai' } });
    expect(open(kaiOnTasks, 'tasks/t-12/diff').route).toEqual({ main: { kind: 'diff', task: 't-12' }, panel: { kind: 'person', person: 'kai' } });
  });

  it('takes a new address as it is, ?panel= and all', () => {
    expect(open(office, 'tasks?panel=tasks/t-12').route).toEqual({ main: { kind: 'tasks' }, panel: { kind: 'task', task: 't-12' } });
    expect(open(kaiOnTasks, 'org?panel=settings').route).toEqual({ main: { kind: 'org' }, panel: { kind: 'settings' } });
  });

  it("says who the talk bar is to for a Message button's address and the composer's, which only the talk bar takes", () => {
    expect(open(office, 'people/kai/message')).toEqual({ route: { main: { kind: 'office' }, panel: { kind: 'person', person: 'kai' } }, talk: { to: { kind: 'person', id: 'kai' } } });
    expect(open(kaiOnTasks, 'send/room/design')).toEqual({ route: kaiOnTasks, talk: { to: { kind: 'room', id: 'design' } } });
    expect(open(kaiOnTasks, 'send')).toEqual({ route: kaiOnTasks, talk: { to: null } });
    expect(open(office, 'people/kai').talk).toBeNull();
  });
});

describe('folder paths', () => {
  it('walks Windows and POSIX folders a level at a time', () => {
    expect(parentOf('C:\\Users\\you\\Projects')).toBe('C:\\Users\\you');
    expect(parentOf('C:\\Users')).toBe('C:\\');
    expect(parentOf('C:\\')).toBeNull();
    expect(parentOf('/home/you/projects/')).toBe('/home/you');
    expect(parentOf('/home')).toBe('/');
    expect(joinPath('C:\\Users\\you\\', 'plant-pal')).toBe('C:\\Users\\you\\plant-pal');
    expect(joinPath('/home/you', 'plant-pal')).toBe('/home/you/plant-pal');
    expect(baseName('C:\\Users\\you\\plant-pal\\')).toBe('plant-pal');
  });

  it('tells the same folder and a folder inside another apart', () => {
    expect(sameFolder('C:\\Users\\You\\Plant-Pal', 'c:\\users\\you\\plant-pal\\')).toBe(true);
    expect(insideOf('C:\\Users\\you\\plant-pal', 'C:\\Users\\you\\plant-pal\\src')).toBe(true);
    expect(insideOf('C:\\Users\\you\\plant-pal', 'C:\\Users\\you\\plant-pal')).toBe(false);
    expect(insideOf('C:\\Users\\you\\plant', 'C:\\Users\\you\\plant-pal')).toBe(false);
    expect(insideOf('/home/you/app', '/home/you/app/web')).toBe(true);
  });
});
