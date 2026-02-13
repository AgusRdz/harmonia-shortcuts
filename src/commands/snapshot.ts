import * as vscode from 'vscode';
import { SnapshotService } from '../services/snapshotService';
import { GovernanceService } from '../services/governanceService';
import { showSnapshotQuickPick, confirmDestructiveAction } from '../providers/decisionQuickPick';

/**
 * Creates a new snapshot
 */
export async function createSnapshot(
	snapshotService: SnapshotService,
	governanceService: GovernanceService
): Promise<void> {
	const name = await vscode.window.showInputBox({
		title: vscode.l10n.t('Create Snapshot'),
		prompt: vscode.l10n.t('Enter a name for this snapshot'),
		placeHolder: vscode.l10n.t('Snapshot name'),
		value: `Snapshot ${new Date().toLocaleDateString()}`,
	});

	if (!name) return;

	const snapshot = await snapshotService.createSnapshot(name, governanceService.getState());

	vscode.window.showInformationMessage(
		vscode.l10n.t('Snapshot "{0}" created successfully.', snapshot.name)
	);
}

/**
 * Restores a snapshot
 */
export async function restoreSnapshot(
	snapshotService: SnapshotService,
	governanceService: GovernanceService
): Promise<void> {
	const snapshots = await snapshotService.getSnapshots();

	if (snapshots.length === 0) {
		vscode.window.showInformationMessage(
			vscode.l10n.t('No snapshots available.')
		);
		return;
	}

	const selectedId = await showSnapshotQuickPick(snapshots);
	if (!selectedId) return;

	const confirmed = await confirmDestructiveAction(
		vscode.l10n.t('This will replace your current keybindings.json and governance state. Continue?'),
		vscode.l10n.t('Restore')
	);

	if (!confirmed) return;

	const restoredState = await snapshotService.restoreSnapshot(selectedId);

	if (restoredState) {
		await governanceService.setState(restoredState);

		const snapshot = await snapshotService.getSnapshot(selectedId);
		vscode.window.showInformationMessage(
			vscode.l10n.t('Snapshot "{0}" restored successfully.', snapshot?.name || selectedId)
		);
	} else {
		vscode.window.showErrorMessage(
			vscode.l10n.t('Failed to restore snapshot.')
		);
	}
}

/**
 * Shows the list of snapshots
 */
export async function showSnapshots(
	snapshotService: SnapshotService
): Promise<void> {
	const snapshots = await snapshotService.getSnapshots();

	if (snapshots.length === 0) {
		vscode.window.showInformationMessage(
			vscode.l10n.t('No snapshots available.')
		);
		return;
	}

	const items = snapshots.map(snapshot => ({
		label: snapshot.name,
		description: new Date(snapshot.createdAt).toLocaleString(),
		detail: snapshot.name === 'Base Snapshot'
			? vscode.l10n.t('Initial state before first audit')
			: undefined,
		id: snapshot.id,
	}));

	const selected = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t('Snapshots'),
		placeHolder: vscode.l10n.t('Select a snapshot to view options'),
	});

	if (!selected) return;

	const action = await vscode.window.showQuickPick([
		{ label: vscode.l10n.t('Restore'), action: 'restore' },
		{ label: vscode.l10n.t('Delete'), action: 'delete' },
		{ label: vscode.l10n.t('Rename'), action: 'rename' },
	], {
		title: vscode.l10n.t('Snapshot: {0}', selected.label),
		placeHolder: vscode.l10n.t('What would you like to do?'),
	});

	if (!action) return;

	switch (action.action) {
		case 'restore':
			const confirmed = await confirmDestructiveAction(
				vscode.l10n.t('This will replace your current keybindings.json. Continue?'),
				vscode.l10n.t('Restore')
			);
			if (confirmed) {
				await snapshotService.restoreSnapshot(selected.id);
				vscode.window.showInformationMessage(
					vscode.l10n.t('Snapshot restored.')
				);
			}
			break;

		case 'delete':
			if (selected.label === 'Base Snapshot') {
				vscode.window.showWarningMessage(
					vscode.l10n.t('Cannot delete the base snapshot.')
				);
				return;
			}
			const deleteConfirmed = await confirmDestructiveAction(
				vscode.l10n.t('Delete snapshot "{0}"?', selected.label),
				vscode.l10n.t('Delete')
			);
			if (deleteConfirmed) {
				await snapshotService.deleteSnapshot(selected.id);
				vscode.window.showInformationMessage(
					vscode.l10n.t('Snapshot deleted.')
				);
			}
			break;

		case 'rename':
			const newName = await vscode.window.showInputBox({
				title: vscode.l10n.t('Rename Snapshot'),
				prompt: vscode.l10n.t('Enter a new name'),
				value: selected.label,
			});
			if (newName) {
				await snapshotService.renameSnapshot(selected.id, newName);
				vscode.window.showInformationMessage(
					vscode.l10n.t('Snapshot renamed to "{0}".', newName)
				);
			}
			break;
	}
}
