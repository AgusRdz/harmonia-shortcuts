import * as vscode from 'vscode';
import { GovernedKeybinding, KeybindingConflict, DecisionAction, RemapResult } from '../types';

/**
 * Quick pick item for keybinding decisions
 */
interface DecisionItem extends vscode.QuickPickItem {
	action: DecisionAction;
}

/**
 * Shows a quick pick for keybinding decisions
 */
export async function showDecisionQuickPick(
	keybinding: GovernedKeybinding
): Promise<DecisionAction | undefined> {
	const items: DecisionItem[] = [
		{
			label: `$(check) ${vscode.l10n.t('Keep Active')}`,
			description: vscode.l10n.t('Approve this shortcut'),
			detail: vscode.l10n.t('The shortcut will remain active as defined by the extension'),
			action: 'keepActive',
		},
		{
			label: `$(circle-slash) ${vscode.l10n.t('Deactivate')}`,
			description: vscode.l10n.t('Disable this shortcut'),
			detail: vscode.l10n.t('Adds a negation entry to keybindings.json to disable this shortcut'),
			action: 'deactivate',
		},
		{
			label: `$(arrow-swap) ${vscode.l10n.t('Remap')}`,
			description: vscode.l10n.t('Change to a different key'),
			detail: vscode.l10n.t('Deactivates the original key and creates a new binding'),
			action: 'remap',
		},
		{
			label: `$(dash) ${vscode.l10n.t('Skip')}`,
			description: vscode.l10n.t('Decide later'),
			detail: vscode.l10n.t('Mark as skipped and come back to this later'),
			action: 'skip',
		},
	];

	const result = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t('Choose Action for {0}', keybinding.key),
		placeHolder: vscode.l10n.t('What would you like to do with this shortcut?'),
	});

	return result?.action;
}

/**
 * Shows an input box for remapping a keybinding
 */
export async function showRemapInput(
	originalKey: string
): Promise<RemapResult> {
	const newKey = await vscode.window.showInputBox({
		title: vscode.l10n.t('Remap Shortcut'),
		prompt: vscode.l10n.t('Enter the new key combination (e.g., ctrl+shift+k)'),
		placeHolder: vscode.l10n.t('New key combination'),
		value: originalKey,
		validateInput: (value) => {
			if (!value.trim()) {
				return vscode.l10n.t('Please enter a key combination');
			}
			if (!/^[a-z0-9+\-\[\]\\;',./`]+$/i.test(value)) {
				return vscode.l10n.t('Invalid key combination format');
			}
			return null;
		},
	});

	if (!newKey) {
		return { success: false, error: 'cancelled' };
	}

	return { success: true, newKey: newKey.toLowerCase() };
}

/**
 * Shows a quick pick for conflict resolution
 */
export async function showConflictQuickPick(
	conflict: KeybindingConflict
): Promise<{ action: 'deactivateAll' | 'deactivateExtensions' | 'viewDetails' } | undefined> {
	type ConflictAction = 'deactivateAll' | 'deactivateExtensions' | 'viewDetails';
	const items: Array<{ label: string; description: string; action: ConflictAction }> = [
		{
			label: `$(circle-slash) ${vscode.l10n.t('Deactivate All Extension Shortcuts')}`,
			description: vscode.l10n.t('Keep only user-defined shortcuts'),
			action: 'deactivateExtensions',
		},
		{
			label: `$(list-flat) ${vscode.l10n.t('View Details')}`,
			description: vscode.l10n.t('See all conflicting bindings'),
			action: 'viewDetails',
		},
	];

	if (!conflict.involvesUserBinding) {
		items.unshift({
			label: `$(circle-slash) ${vscode.l10n.t('Deactivate All')}`,
			description: vscode.l10n.t('Deactivate all conflicting shortcuts'),
			action: 'deactivateAll',
		});
	}

	const result = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t('Resolve Conflict: {0}', conflict.key),
		placeHolder: vscode.l10n.t('How would you like to resolve this conflict?'),
	});

	return result;
}

/**
 * Shows a quick pick for extension batch operations
 */
export async function showExtensionBatchQuickPick(
	extensionName: string,
	pendingCount: number
): Promise<'approveAll' | 'deactivateAll' | undefined> {
	const items = [
		{
			label: `$(check-all) ${vscode.l10n.t('Approve All')}`,
			description: vscode.l10n.t('Keep all {0} shortcuts active', pendingCount),
			action: 'approveAll' as const,
		},
		{
			label: `$(circle-slash) ${vscode.l10n.t('Deactivate All')}`,
			description: vscode.l10n.t('Deactivate all {0} shortcuts', pendingCount),
			action: 'deactivateAll' as const,
		},
	];

	const result = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t('Batch Action for {0}', extensionName),
		placeHolder: vscode.l10n.t('Choose an action for all pending shortcuts'),
	});

	return result?.action;
}

/**
 * Shows a quick pick for snapshot selection
 */
export async function showSnapshotQuickPick(
	snapshots: Array<{ id: string; name: string; createdAt: number }>
): Promise<string | undefined> {
	const items = snapshots.map(snapshot => ({
		label: snapshot.name,
		description: new Date(snapshot.createdAt).toLocaleString(),
		id: snapshot.id,
	}));

	const result = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t('Select Snapshot'),
		placeHolder: vscode.l10n.t('Choose a snapshot to restore'),
	});

	return result?.id;
}

/**
 * Shows confirmation for destructive actions
 */
export async function confirmDestructiveAction(
	message: string,
	confirmLabel: string
): Promise<boolean> {
	const result = await vscode.window.showWarningMessage(
		message,
		{ modal: true },
		confirmLabel
	);

	return result === confirmLabel;
}
