// What the office says when there is nothing to show yet, or something is in the way.
import type { Snapshot } from '../../../src/core/snapshot.ts';

export function Loading() {
  return (
    <div className="screen" role="status">
      <p className="screen__title">Opening the office</p>
      <p className="screen__text">Connecting to the Worklings server on this machine.</p>
    </div>
  );
}

export function Locked() {
  return (
    <div className="screen" role="alert">
      <p className="screen__title">This office needs its access link</p>
      <p className="screen__text">
        Open it with the link that <code>worklings</code> printed in your terminal. The link carries a token, so nobody
        else on the network can watch or change your studio.
      </p>
    </div>
  );
}

export function NoStudio({ snapshot }: { snapshot: Snapshot }) {
  return (
    <section className="callout" aria-labelledby="no-studio">
      <h2 id="no-studio" className="callout__title">No studio here yet</h2>
      <p>
        {snapshot.project.name} has no <code>.claude/studio.yaml</code> and no subagents, so the building is empty. Sessions
        still show up in the lobby and the lead's office.
      </p>
      <p>Create a studio for this project in Claude Code, or in a terminal:</p>
      <pre className="callout__code">/worklings:new what you are building</pre>
      <pre className="callout__code">worklings new --idea "what you are building"</pre>
      <p className="muted">Already have agents in another layout? <code>worklings adopt --write</code> sorts them into rooms.</p>
    </section>
  );
}

export function WaitingForSessions({ snapshot }: { snapshot: Snapshot }) {
  const ignored = snapshot.hooks.ignored;
  return (
    <section className="callout callout--inline" aria-labelledby="waiting">
      <h3 id="waiting" className="callout__title">Waiting for Claude Code</h3>
      {ignored > 0 && (
        <p>
          {ignored} hook {ignored === 1 ? 'event' : 'events'} came from sessions outside this folder. The office shows only sessions
          started in {snapshot.project.name}, so start Claude Code there.
        </p>
      )}
      <ol className="steps">
        <li>
          Let sessions report here: <code>worklings hooks install</code>
        </li>
        <li>Start Claude Code in this project folder and give it something to do.</li>
      </ol>
      <p className="muted">Hooks fail quietly while the office is closed, so they never slow a session down.</p>
    </section>
  );
}

export function StudioErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <section className="callout callout--warn" role="alert" aria-labelledby="studio-errors">
      <h3 id="studio-errors" className="callout__title">studio.yaml has problems, so rooms were guessed from the agents</h3>
      <ul className="plain-list">
        {errors.slice(0, 6).map((e) => <li key={e}><code>{e}</code></li>)}
      </ul>
    </section>
  );
}

export function NoWebGL() {
  return (
    <div className="screen screen--inline" role="note">
      <p className="screen__title">The 3D view needs WebGL</p>
      <p className="screen__text">This browser has it switched off. Everything else works: the team, payroll and log are in the panel.</p>
    </div>
  );
}
