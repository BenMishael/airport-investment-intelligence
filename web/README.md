# Airport Investment Intelligence Web

Next.js interview workspace with allowlisted Supabase email OTP, session-scoped authentication, persisted analyses, and evidence-first airport comparisons.

## Local development

```bash
cd web
npm ci
cp .env.example .env.local
npm run dev
```

Set the API origin plus Supabase project URL and anon/publishable key. Use **http://localhost:3000** in the browser. Visiting `http://127.0.0.1:3000` redirects to localhost so the Supabase OTP origin matches. In the Supabase dashboard set Site URL to `http://localhost:3000` and add both `http://localhost:3000` and `http://127.0.0.1:3000` under Redirect URLs. The browser session is stored in `sessionStorage` and every API request carries the Supabase access token. Never place a service-role, SMTP, database, or LLM credential in a `NEXT_PUBLIC_*` variable.

Optional: `NEXT_PUBLIC_DEFAULT_LLM_PROVIDER=groq` or `gemini` sets the composer Groq/Gemini default. The choice is stored in `sessionStorage` and sent with each `/chat` request; scores stay deterministic.

For a local auth-free API demonstration, the API may use `AUTH_REQUIRED=false`, but the browser still expects Supabase authentication. Use the Supabase CLI configuration in `../api/supabase` for an end-to-end local OTP flow.

## Interface system

The UI uses self-hosted Newsreader and IBM Plex Sans fonts, semantic light/dark tokens, and three deliberately separate motion layers:

- CSS handles immediate hover, focus, press, and color feedback.
- Motion handles React state transitions, shared layout, lists, drawers, dialogs, and evidence bars.
- Lottie is reserved for route context, evidence progress, and result resolution. Animation JSON is loaded only when supplied and visible; every placement has a static poster fallback.

Theme preference is stored in `localStorage`. Authentication remains session-scoped in `sessionStorage`. `MotionConfig` follows the operating system's reduced-motion setting, and all exact evidence values appear without waiting for animation.

### Asset intake

Candidate SVG, PNG, and Lottie files belong in `public/assets/inbox/`. Review them against [the asset intake specification](public/assets/README.md), then move approved files into a production folder and record their license and provenance in `public/assets/manifest.json`.

```bash
npm run assets:validate         # technical validation plus provenance warnings
npm run assets:validate:strict  # release check; requires approved licenses
```

The airplane/globe mark and all three Lottie animations are installed and connected to the interface. The Lotties pass technical validation but remain in `review` status until their original source URLs and redistribution-compatible licenses are added to the manifest. Static project-owned SVG posters remain available for reduced motion and failed animation loads.

## UI and UX agent skills

The repository vendors [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) v2.15.0 for Codex, Claude, and Cursor. Each assistant receives the complete skill bundle in its native project directory:

- Codex: `.agents/skills/`
- Claude: `.claude/skills/`
- Cursor: `.cursor/skills/`

The bundle includes `ui-ux-pro-max`, `banner-design`, `brand`, `design-system`, `design`, `slides`, and `ui-styling`. These directories are generated artifacts: update them with the pinned CLI instead of editing their datasets or scripts manually.

Python 3 is required by the bundled search tools. After `npm ci`, refresh every assistant's copy with:

```bash
npm run skills:ui-ux:sync
```

Individual refresh commands are also available as `skills:ui-ux:codex`, `skills:ui-ux:claude`, and `skills:ui-ux:cursor`. The commands run offline from the pinned npm package and overwrite existing generated copies, making updates non-interactive and reproducible. Restart the relevant coding assistant after installation or refresh so it discovers the skills.

Third-party attribution and license details are recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run format:check
npm run build
npm run assets:validate
npm run test:e2e
```

The Playwright capture suite runs the email, OTP, empty, loading, error, comparison, ranking, and persisted-conversation states at 375, 768, 1024, and 1440 pixels in light, dark, and reduced-motion modes. It uses local network mocks and never contacts the production Supabase or API projects.

The application uses `src/app`, feature modules, one authenticated API client, typed response contracts, sanitized React text rendering, CSP/security headers, accessible status feedback, and responsive states. Configure the deployed API’s `CORS_ORIGINS` to this exact web origin.
