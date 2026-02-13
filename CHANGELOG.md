# Changelog

## [1.0.0] - 2026-02-12

### Added

- **Shortcut Audit Panel** - Central webview to review, approve, deactivate, remap, or skip every extension shortcut
  - Conflicts, Unreviewed, Reviewed, and User Shortcuts sections
  - Collapsible extension and conflict cards with accordion behavior
  - Per-shortcut actions (Approve, Deactivate, Remap, Skip) and batch actions per extension
  - Statistics bar with real-time counts by status
  - "All clear!" indicator when every shortcut has been reviewed
- **Conflict Detection** - Context-aware detection of key collisions between extension and user shortcuts
  - Groups bindings by `when` clause so non-overlapping contexts are not flagged
  - Per-binding Remap and Deactivate options within each conflict
  - Bulk "Deactivate All Extension Conflicts" action with confirmation
  - Excludes user-vs-user conflicts (intentional, not actionable)
  - Excludes already deactivated or remapped bindings from detection
- **Interactive Remap Modal** - Capture key combinations directly from the keyboard
  - Modifier key support (Ctrl, Shift, Alt, Cmd)
  - Chord support (e.g., `Ctrl+K Ctrl+K`)
  - Enter to confirm, Backspace to clear, Escape to cancel
- **Snapshots** - Version your keybindings.json and governance state
  - Base snapshot created automatically on first run
  - Create, restore, rename, and delete snapshots from the panel or Command Palette
  - Up to 10 snapshots with base snapshot always protected
- **Import / Export** - Back up and restore governance decisions across machines or profiles
  - Export all decisions grouped by extension (v3 JSON format)
  - Import with backward compatibility for v2 format
- **New Shortcut Detection** - Notifications when extensions are installed or updated with new keybindings
  - Configurable via `harmonia-shortcuts.notifyOnNewShortcuts` setting
- **First-Run Onboarding** - Welcome notification with automatic base snapshot creation
- **Uninstall Cleanup** - Removes all Harmonia entries from keybindings.json with optional backup
- **Localization** - Full English and Spanish (Español) support

---
