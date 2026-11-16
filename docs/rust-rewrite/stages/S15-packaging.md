# S15 — Packaging and release

**Depends on:** every earlier stage.
**Read first:** spec §16; `03` (all); `04` §§1, 4.

## Goal
Something a current Reamlet user can install over their existing copy and
carry on, plus a portable build, produced by CI with the performance gates
enforced.

## Deliverables
1. **Executable metadata**: icon, version resource, application manifest
   (per-monitor-v2 DPI awareness, long-path awareness, UTF-8 code page,
   supported-OS entries, `asInvoker`).
2. **Installer** (per-user, no elevation; tool chosen by the agent — NSIS,
   Inno Setup or WiX — and recorded): installs to
   `%LOCALAPPDATA%\Programs\Reamlet` (the same folder the previous version
   used, so shortcuts and the helper's fallback path keep working); desktop
   and Start-menu shortcuts; Add/Remove Programs entry; writes the native
   messaging manifest (preserving a previously saved extension ID via the
   app's own start-up re-application) and the six browser keys by calling
   `Reamlet.exe --register-host`; file association by
   `--register-file-assoc`; finish page with "Launch Reamlet" and unticked
   "Set Reamlet as the default PDF viewer" (`03` §7).
   Upgrading: closes a running Reamlet (asks first), replaces files, removes
   files the previous version left that are no longer used.
3. **Uninstaller**: closes running instances, removes files, shortcuts,
   registry entries from `03` §§4.1 and 7 (including the stray legacy value),
   leaves the user's data folder unless they tick "also remove settings".
4. **Portable build**: a zip of `Reamlet.exe`, the engine library (if not
   statically linked), `reamlet-native-host.exe`, the manifest template,
   licences and a short README. Runs from any folder; helper registration via
   the app (S13).
5. **Upgrade compatibility test data**: sample `settings.json`,
   `session.json` and data-folder contents captured from the previous version
   (the owner supplies real ones, scrubbed) used as fixtures.
6. **Third-party notices** generated from the dependency tree, plus the
   PDFium and Liberation Sans licences and the GPL text, shipped in the
   install folder and the portable zip. (There is no About box in the spec;
   if the owner wants one, it is a follow-up.)
7. **Release workflow** (CI): on a version tag — build release, run all tests
   and `cargo xtask perf --check`, build installer and portable zip, compute
   checksums, create a draft GitHub release with artefacts. Optional code
   signing step that activates when a certificate is configured.
8. **README** for the new repository: what it is, download, features,
   shortcuts table, building from source, licence.
9. **Version** single-sourced from the workspace manifest.

## Acceptance
Automated (Windows CI, fresh runner user profile):
- Silent install → files present, shortcuts present, registry entries exactly
  as `03` §§4.1 and 7; `Reamlet.exe --exit-after-first-frame` runs from the
  install folder.
- Install over a simulated previous-version layout with the upgrade fixtures:
  theme, toggles, printer rules and extension ID are honoured; the saved
  session restores; unknown settings keys are preserved after a settings
  change.
- Silent uninstall → install folder, shortcuts and all listed registry entries
  gone; data folder kept by default.
- Portable zip extracted to a path with spaces and non-ASCII characters runs,
  opens a fixture, and can register/unregister the helper.
- Size budgets (`04` §1.4) hold for the produced artefacts.
- Start-up and memory budgets hold **for the installed build** (not just the
  cargo target directory).
- The native host launched from the registered manifest path answers a
  message.
- Licence gate: `cargo deny` clean; notices file lists every dependency.

Manual (owner): install over their real current Reamlet and confirm tabs,
settings and the browser extension still work; set as default via the Windows
page; open a PDF from Explorer; uninstall.

## Out of scope
Auto-update, Microsoft Store packaging, other platforms. Record them as
follow-ups if the owner wants them.
