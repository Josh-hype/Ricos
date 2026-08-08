export const meta = {
  name: 'design-loop',
  description: 'Build a shop landing page against a reference visual, critique it from several angles, fix, repeat until it matches',
  whenToUse: 'When a shop has a landing-page design visual in data/shops/<slug>/reference/ and assets in assets/, and the page has to end up looking like it.',
  phases: [
    { title: 'Render', detail: 'build the shop, screenshot desktop + mobile, measure against the reference' },
    { title: 'Critique', detail: 'five critics, one lens each, comparing the render to the reference' },
    { title: 'Fix', detail: 'apply the surviving findings to the shop landing page' },
    { title: 'Verdict', detail: 'an independent read of whether it now matches' },
  ],
};

/* ---------------------------------------------------------------------------
 * args: { slug, maxRounds?, reference? }
 *
 * The loop is: render -> critique from five angles -> fix -> render again, and
 * it stops when two consecutive rounds produce no major differences, or when
 * maxRounds is spent. Two rounds, not one: a single clean round is regularly
 * just a round where the critics happened to look elsewhere.
 *
 * Everything the critics see is produced by tools, not by memory — the render
 * harness screenshots what the build actually serves, and compare.py turns
 * "the colours are off" into a measured distance. The one thing this cannot do
 * is decide the design is wrong; if the reference asks for something that
 * breaks on a phone, that is reported, not silently improved.
 * ------------------------------------------------------------------------- */

const slug = (args && args.slug) || 'acombkebabpizzahouse';
const MAX_ROUNDS = (args && args.maxRounds) || 6;
const SHOP = `data/shops/${slug}`;

const FINDINGS = {
  type: 'object',
  required: ['matches', 'findings'],
  properties: {
    matches: { type: 'boolean', description: 'true ONLY if you found nothing a client would ask to change' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'area', 'reference_shows', 'build_shows', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['major', 'minor'], description: 'major = a client would reject the page over it' },
          area: { type: 'string', description: 'which part of the page, e.g. "hero", "menu strip", "footer"' },
          reference_shows: { type: 'string' },
          build_shows: { type: 'string' },
          fix: { type: 'string', description: 'the concrete CSS/HTML change, with numbers where you have them' },
          evidence: { type: 'string', description: 'the measurement or outline entry this rests on, if any' },
        },
      },
    },
  },
};

const VERDICT = {
  type: 'object',
  required: ['matches', 'reason', 'remaining'],
  properties: {
    matches: { type: 'boolean' },
    reason: { type: 'string' },
    remaining: { type: 'array', items: { type: 'string' } },
  },
};

const LENSES = [
  { key: 'layout', prompt: `LAYOUT AND STRUCTURE ONLY. Do the same sections exist, in the same order, at the same relative heights? Is anything in the reference missing from the build, or in the build but not the reference? Check column counts, alignment, and what is above the fold. Ignore colour and typography — other critics own those.` },
  { key: 'type', prompt: `TYPOGRAPHY ONLY. Compare typeface character (serif/sans/display/script), size hierarchy, weight, case, letter-spacing, line-height and text alignment. Quote the actual font strings from outline.json rather than guessing what is rendering. Ignore layout and colour.` },
  { key: 'colour', prompt: `COLOUR AND SURFACE ONLY. Compare the palette (use the measured palette distances in compare.json — do not eyeball hex codes), backgrounds, gradients, borders, shadows and overlays. Call out any brand colour in the reference that is absent from the render. Also flag any text whose contrast looks below WCAG AA (4.5:1 body, 3:1 large).` },
  { key: 'imagery', prompt: `IMAGERY AND ASSETS ONLY. Is the right asset in the right slot? Compare crop, aspect ratio, focal point, size and position of every photo/graphic. List any file in ${SHOP}/assets/ that the reference clearly uses but the page does not, and any the page uses in a place the reference does not.` },
  { key: 'spacing', prompt: `SPACING AND MOBILE ONLY. Compare padding, gaps and vertical rhythm between sections, using the band fractions in compare.json. Then look at mobile.png specifically: anything overlapping, clipped, off-screen or unreadably small, and any horizontal overflow reported in render.json. A design visual is usually desktop-only, so where the reference is silent, say what the mobile SHOULD do rather than inventing a reference for it.` },
];

const renderPrompt = (round) => `You are the render step of a design loop for the shop "${slug}".

Run, from the repo root:
  node tools/design-loop/render.mjs ${slug} --round ${round}

Then for EACH of desktop.png and mobile.png in the run directory it reports, run:
  python3 tools/design-loop/compare.py <the matching reference image> <the render> tools/design-loop/runs/${slug}/round-${round}/<desktop|mobile>-cmp

The reference images are in ${SHOP}/reference/. Match them up sensibly by name
(a file with "mobile" in the name is the mobile reference; if there is only one
reference image, it is the desktop one and mobile has no reference).
Save each compare.py JSON next to its side-by-side as compare.json.

If render.mjs exits non-zero, DO NOT paper over it — return the error. A failed
build must stop the loop, not produce a stale screenshot.

Return: the run directory, the screenshot paths, the side-by-side paths, the
compare.json paths, and any build warnings or page errors render.mjs reported.`;

const critiquePrompt = (round, lens) => `You are one of five critics comparing a built landing page to the design the shop owner supplied. Round ${round}.

${lens.prompt}

Look at, with the Read tool (it shows you images):
  - the reference: ${SHOP}/reference/  (all files)
  - the build:     tools/design-loop/runs/${slug}/round-${round}/desktop.png and mobile.png
  - the side-by-side and measurements in the *-cmp folders of that run directory
  - tools/design-loop/runs/${slug}/round-${round}/outline.json — the rendered
    boxes, fonts and colours, so you can cite numbers instead of impressions
  - the source you would be asking to change: ${SHOP}/index.html

Rules:
  - Only report differences YOU CAN SEE or MEASURE. No speculative polish, no
    "consider adding", no generic web-design advice. If your lens finds nothing,
    return matches:true with an empty list, and that is a good outcome.
  - severity "major" means a client looking at both would say it is wrong.
    Everything else is minor.
  - Give each fix as a concrete change with numbers where you have them.
  - The reference is a picture, not a spec: if matching it exactly would break
    the page (text below AA contrast, a fixed width that overflows a phone, a
    tap target under 44px), say so in the finding instead of demanding it.`;

const fixPrompt = (round, findings) => `You are the fix step of a design loop for "${slug}", round ${round}.

Apply these findings to the landing page. They came from five critics that each
looked at one aspect of the render against the owner's reference visual.

${JSON.stringify(findings, null, 1)}

Rules that matter more than the findings:
  - Edit ONLY ${SHOP}/index.html (the shop's bespoke landing page) and, if the
    palette is wrong, config.theme in ${SHOP}/config.json. Do NOT touch
    templates/ or functions/ — that is shared code and would change every other
    shop's site. If a finding can only be fixed in shared code, skip it and say
    so in your return value.
  - Use the assets already in ${SHOP}/assets/. They are served from /assets/<filename>.
    Do not invent filenames — list the directory first. If the design needs an
    asset that is not there, say which, and leave that slot alone.
  - Keep the {{token}} placeholders the build substitutes (business name, phone,
    address, hours). Do not hard-code values the config owns.
  - Where two findings conflict, prefer the one with a measurement behind it.
  - Do not "improve" anything nobody asked about.

Return: what you changed, what you deliberately skipped and why, and any asset
you needed that does not exist.`;

/* ------------------------------- the loop -------------------------------- */
let clean = 0;
let round = 0;
const history = [];

while (round < MAX_ROUNDS && clean < 2) {
  phase('Render');
  const render = await agent(renderPrompt(round), { label: `render:r${round}`, phase: 'Render' });
  if (!render || /exit(ed)? non-?zero|build failed|refusing to screenshot/i.test(render)) {
    log(`round ${round}: render failed — stopping. ${String(render).slice(0, 300)}`);
    return { stopped: 'render-failed', round, detail: render, history };
  }

  phase('Critique');
  const reports = (await parallel(LENSES.map((lens) => () =>
    agent(critiquePrompt(round, lens), { label: `critic:${lens.key}`, phase: 'Critique', schema: FINDINGS })
      .then((r) => (r ? { lens: lens.key, ...r } : null)))))
    .filter(Boolean);

  const all = reports.flatMap((r) => (r.findings || []).map((f) => ({ lens: r.lens, ...f })));
  const major = all.filter((f) => f.severity === 'major');
  log(`round ${round}: ${all.length} finding(s), ${major.length} major, from ${reports.length}/${LENSES.length} critics`);
  history.push({ round, findings: all.length, major: major.length, byLens: Object.fromEntries(reports.map((r) => [r.lens, (r.findings || []).length])) });

  if (!all.length) {
    clean++;
    log(`round ${round}: clean (${clean}/2 consecutive)`);
    round++;
    continue;
  }
  clean = 0;

  phase('Fix');
  const fixed = await agent(fixPrompt(round, all), { label: `fix:r${round}`, phase: 'Fix' });
  history[history.length - 1].fix = String(fixed).slice(0, 1500);
  round++;
}

/* A final, independent read. The critics have been staring at this for several
 * rounds and each owns one lens; none of them has been asked the plain question
 * a client asks. This agent has not seen the findings, only the two pictures. */
phase('Verdict');
const verdict = await agent(
  `Round ${round}. Look at the owner's reference visual in ${SHOP}/reference/ and the latest render in ` +
  `tools/design-loop/runs/${slug}/round-${round - 1}/ (desktop.png and mobile.png, plus the side-by-side).\n\n` +
  `One question, answered honestly: would the shop owner, holding their design next to this page, say it is the same design?\n\n` +
  `Do not be generous. List anything still visibly different. If it matches, say so plainly.`,
  { label: 'verdict', phase: 'Verdict', schema: VERDICT });

return {
  slug,
  rounds: round,
  converged: clean >= 2,
  stoppedBecause: clean >= 2 ? 'two consecutive clean rounds' : `hit maxRounds (${MAX_ROUNDS})`,
  verdict,
  history,
};
