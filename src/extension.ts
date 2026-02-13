import * as vscode from 'vscode';
import {
	KeybindingsFileService,
	KeybindingParser,
	GovernanceService,
	ConflictService,
	SnapshotService,
	ExtensionWatcher,
} from './services';
import { AuditPanelProvider } from './providers';
import { registerCommands } from './commands';

let extensionWatcher: ExtensionWatcher | undefined;
let auditPanel: AuditPanelProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	// Initialize services
	const fileService = new KeybindingsFileService();
	const parser = new KeybindingParser(fileService);
	const governanceService = new GovernanceService(context, fileService, parser);
	const conflictService = new ConflictService();
	const snapshotService = new SnapshotService(context, fileService);

	// Initialize WebView panel provider
	auditPanel = new AuditPanelProvider(
		context.extensionUri,
		governanceService,
		parser,
		conflictService
	);
	context.subscriptions.push({ dispose: () => auditPanel?.dispose() });

	// Initialize extension watcher
	extensionWatcher = new ExtensionWatcher(governanceService, parser, auditPanel);
	context.subscriptions.push(extensionWatcher);

	// Register open audit panel command
	context.subscriptions.push(
		vscode.commands.registerCommand('harmonia-shortcuts.openAudit', () => {
			auditPanel?.show();
		})
	);

	// Register all other commands
	registerCommands(
		context,
		governanceService,
		snapshotService,
		conflictService,
		parser,
		auditPanel
	);

	// Handle first run
	if (governanceService.isFirstRun()) {
		await handleFirstRun(context, snapshotService, governanceService, auditPanel);
	} else {
		// Check for new shortcuts from updated extensions
		await extensionWatcher.initialCheck();
	}
}

/**
 * Handles the first run experience
 */
async function handleFirstRun(
	context: vscode.ExtensionContext,
	snapshotService: SnapshotService,
	governanceService: GovernanceService,
	auditPanel: AuditPanelProvider
): Promise<void> {
	// Create base snapshot
	await snapshotService.createBaseSnapshot(governanceService.getState());

	// Update extension versions
	const parser = new KeybindingParser(new KeybindingsFileService());
	await governanceService.updateExtensionVersions(parser.getExtensionVersions());

	// Show welcome message
	const startAudit = vscode.l10n.t('Start Audit');
	const later = vscode.l10n.t('Later');

	const result = await vscode.window.showInformationMessage(
		vscode.l10n.t(
			'Welcome to Harmonia Shortcuts! A base snapshot of your keybindings has been created. ' +
			'Would you like to audit your extension shortcuts now?'
		),
		startAudit,
		later
	);

	if (result === startAudit) {
		await auditPanel.show();
	}

	// Mark initial audit as complete (even if they chose later)
	await governanceService.markInitialAuditComplete();
}

export function deactivate(): void {
	extensionWatcher?.dispose();
	auditPanel?.dispose();
}
