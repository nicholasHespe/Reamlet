# S15 — Packaging and release

**Depends on:** every earlier stage.
**Read first:** spec §16; `03` (all); `04` §§1, 4.

## Goal
An installer and a portable build, produced by CI with the performance gates
enforced. This is a fresh product: nothing from an earlier version is
migrated, detected or cleaned up.

## Deliverables
1. **Executable metadata**: icon, version resource, application manifest
   (per-monitor-v2 DPI awareness, long-path awareness, UTF-8 code page,
   supported-OS entries, `asInvoker`).
2. **Installer** (per-user, no elevation; tool chosen by the agent — NSIS,
   Inno Setup or WiX — and recorded): installs to
   `%LOCALAPPDATA%\Programs\Margin`; desktop
   and Start-menu shortcuts; Add/Remove Programs entry; writes the native
   messaging manifest and the six browser keys by calling
   `Margin.exe --register-host`; file association by
   `--register-file-assoc`; finish page with "Launch Margin" and unticked
   "Set Margin as the default PDF viewer" (`03` §7).
   Installing a newer build of this program over an older one closes a
   running Margin (asks first) and replaces its files; the user's settings,
   and session carry over because they live in the data folder.
3. **Uninstaller**: closes running instances, removes files, shortcuts,
   registry entries from `03` §§4.1 and 7,
   leaves the user's data folder unless they tick "also remove settings".
4. **Portable build**: a zip of `Margin.exe`, the engine library (if not
   statically linked), `margin-native-host.exe`,
   licences and a short README. Runs from any folder; helper registration via
   the app (S13).
5. **Third-party notices** generated from the dependency tree, plus the
   PDFium and Liberation Sans licences and the GPL text, shipped in the
   install folder and the portable zip. (There is no About box in the spec;
   if the owner wants one, it is a follow-up.)
6. **Release workflow** (CI): on a version tag — build release, run all tests
   and `cargo xtask perf --check`, build installer and portable zip, compute
   checksums, create a draft GitHub release with artefacts. Optional code
   signing step that activates when a certificate is configured.
7. **README** for the new repository: what it is, download, features,
   shortcuts table, building from source, licence.
8. **Version** single-sourced from the workspace manifest.

## Acceptance
Automated (Windows CI, fresh runner user profile):
- Silent install → files present, shortcuts present, registry entries exactly
  as `03` §§4.1 and 7; `Margin.exe --exit-after-first-frame` runs from the
  install folder.
- Install build N, change theme, a toggle and a printer rule, open two tabs with Keep Tabs on, then install build N+1 over it: all of
  those are intact and the session restores.
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

Manual (owner): install on a real machine and confirm the browser extension
works with no further setup; set as default via the Windows
page; open a PDF from Explorer; uninstall.

## Out of scope
Auto-update, Microsoft Store packaging, other platforms. Record them as
follow-ups if the owner wants them.
