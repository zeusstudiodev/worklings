import { expect, test } from '@playwright/test';
import { open, running, shot, sidePanel, watchErrors } from './v3-kit.ts';
import { lobby, RESETS_AT_S, REST_HUB, say, view } from './v3-world.ts';

// A usage limit rests every company of a hub until the reset, so this spec has a hub of its own and runs
// once: the second viewport would find the first one's rest still on. The phone width is checked at the end instead.
test.describe('a usage-limit rest', () => {
  test('the company rests until the time Claude Code reported, and the office says so everywhere', async ({ page, request }, info) => {
    test.skip(info.project.name !== 'v3', 'The rest is hub-wide: checked once, with a phone-sized look at the end.');
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    const id = await running(request, 'rest', { hub: REST_HUB });
    await say(request, id, 'qa-engineer', '[fake:limit] Run the tests', REST_HUB);
    await expect.poll(async () => (await view(request, id, REST_HUB)).pause, { timeout: 60_000 }).toMatchObject({ reason: 'usage-limit', until: RESETS_AT_S * 1000 });
    expect((await lobby(request, REST_HUB)).companies.find((c) => c.id === id)?.pause).toMatchObject({ reason: 'usage-limit', until: RESETS_AT_S * 1000 });

    // The time as the browser writes it, so the check doesn't depend on this machine's locale.
    await open(page, `/c/${id}`, REST_HUB);
    const until = String(await page.evaluate(`new Date(${RESETS_AT_S * 1000}).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })`));
    await expect(page.getByRole('banner')).toContainText(`Resting until ${until}`, { timeout: 30_000 });
    // A callout tops the inbox, the side panel's home, with the state's sentence and its action.
    const inbox = sidePanel(page);
    await expect(inbox).toContainText(`Resting until ${until}, when your plan's limit resets. Work picks up by itself.`);
    await expect(inbox.getByRole('button', { name: 'Try now' })).toBeVisible();
    await shot(page, 'rest-company', info);

    // The lobby says every company rests, and starting another waits.
    await open(page, '/', REST_HUB);
    const alert = page.getByRole('alert', { name: 'Every company rests' });
    await expect(alert).toContainText(`Every company rests until ${until}.`);
    await expect(page.getByRole('button', { name: 'Start a new company' })).toBeDisabled();
    await shot(page, 'rest-lobby', info);

    // And on a phone.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(alert).toBeVisible();
    await shot(page, 'rest-lobby-phone', info);
    await open(page, `/c/${id}`, REST_HUB);
    await expect(page.getByRole('banner')).toContainText(`Resting until ${until}`);
    await shot(page, 'rest-company-phone', info);
    expect(errors).toEqual([]);
  });
});
