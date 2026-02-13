import * as vscode from 'vscode';
import { GovernanceService } from '../services/governanceService';
import { SnapshotService } from '../services/snapshotService';
import { ConflictService } from '../services/conflictService';
import { KeybindingParser } from '../services/keybindingParser';
import { AuditPanelProvider } from '../providers/auditPanelProvider';

/**
 * Registers all commands for the extension
 */
export function registerCommands(
	context: vscode.ExtensionContext,
	governanceService: GovernanceService,
	snapshotService: SnapshotService,
	conflictService: ConflictService,
	parser: KeybindingParser,
	auditPanel: AuditPanelProvider
): void {
	const commands: Array<{ id: string; handler: () => void | Promise<void> }> = [
		{
			id: 'harmonia-shortcuts.startAudit',
			handler: () => auditPanel.show(),
		},
		{
			id: 'harmonia-shortcuts.refresh',
			handler: () => auditPanel.refresh(),
		},
		{
			id: 'harmonia-shortcuts.openKeybindingsFile',
			handler: () => {
				vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
			},
		},
	];

	for (const { id, handler } of commands) {
		context.subscriptions.push(
			vscode.commands.registerCommand(id, handler)
		);
	}
}
