import * as vscode from 'vscode';
import {
	Keybinding,
	GovernedKeybinding,
	KeybindingConflict,
	GovernanceStatus,
} from '../types';
import { GovernanceService } from '../services/governanceService';
import { KeybindingParser } from '../services/keybindingParser';
import { ConflictService } from '../services/conflictService';

interface AuditData {
	userKeybindings: GovernedKeybinding[];
	extensionGroups: Array<{
		id: string;
		name: string;
		keybindings: GovernedKeybinding[];
		stats: { pending: number; approved: number; deactivated: number; remapped: number };
	}>;
	conflicts: KeybindingConflict[];
	stats: {
		total: number;
		pending: number;
		approved: number;
		deactivated: number;
		remapped: number;
		skipped: number;
		conflicts: number;
	};
}

export class AuditPanelProvider {
	public static readonly viewType = 'harmonia-shortcuts.auditPanel';
	private panel: vscode.WebviewPanel | undefined;
	private disposables: vscode.Disposable[] = [];

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly governanceService: GovernanceService,
		private readonly parser: KeybindingParser,
		private readonly conflictService: ConflictService
	) {
		this.governanceService.onStateChanged(() => this.refresh());
	}

	public async show(): Promise<void> {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.One);
			await this.refresh();
			return;
		}

		this.panel = vscode.window.createWebviewPanel(
			AuditPanelProvider.viewType,
			vscode.l10n.t('Shortcuts Audit'),
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [this.extensionUri],
			}
		);

		this.panel.iconPath = new vscode.ThemeIcon('keyboard');

		this.panel.onDidDispose(() => {
			this.panel = undefined;
			this.disposables.forEach(d => d.dispose());
			this.disposables = [];
		}, null, this.disposables);

		this.panel.webview.onDidReceiveMessage(
			message => this.handleMessage(message),
			null,
			this.disposables
		);

		await this.refresh();
	}

	public async refresh(): Promise<void> {
		if (!this.panel) return;

		const data = await this.getAuditData();
		this.panel.webview.html = this.getHtml(this.panel.webview, data);
	}

	private async getAuditData(): Promise<AuditData> {
		const { user, extension } = await this.parser.getAllKeybindings();
		const extensionGroups = this.parser.getExtensionKeybindings();

		// Exclude deactivated/remapped bindings from conflict detection —
		// they no longer compete for the key, so the conflict is resolved.
		const activeExtension = extension.filter(kb => {
			const status = this.governanceService.getStatus(kb.id);
			return status !== 'deactivated' && status !== 'remapped';
		});
		const allConflicts = this.conflictService.detectConflicts(user, activeExtension);

		// Only show conflicts that involve at least one extension binding —
		// user-vs-user conflicts are intentional and not actionable from the panel.
		const conflicts = allConflicts.filter(c =>
			c.bindings.some(b => b.source === 'extension')
		);

		const userGoverned = this.governanceService.getGovernedKeybindings(user);

		const groups = extensionGroups.map(ext => {
			const governed = this.governanceService.getGovernedKeybindings(ext.keybindings);
			return {
				id: ext.id,
				name: ext.name,
				keybindings: governed,
				stats: {
					pending: governed.filter(k => k.status === 'pending').length,
					approved: governed.filter(k => k.status === 'approved').length,
					deactivated: governed.filter(k => k.status === 'deactivated').length,
					remapped: governed.filter(k => k.status === 'remapped').length,
				},
			};
		}).filter(g => g.keybindings.length > 0);

		const allExtensionBindings = groups.flatMap(g => g.keybindings);

		return {
			userKeybindings: userGoverned,
			extensionGroups: groups,
			conflicts,
			stats: {
				total: allExtensionBindings.length,
				pending: allExtensionBindings.filter(k => k.status === 'pending').length,
				approved: allExtensionBindings.filter(k => k.status === 'approved').length,
				deactivated: allExtensionBindings.filter(k => k.status === 'deactivated').length,
				remapped: allExtensionBindings.filter(k => k.status === 'remapped').length,
				skipped: allExtensionBindings.filter(k => k.status === 'skipped').length,
				conflicts: conflicts.length,
			},
		};
	}

	private async handleMessage(message: { command: string; data?: unknown }): Promise<void> {
		switch (message.command) {
			case 'approve': {
				const { keybindingId, extensionId } = message.data as { keybindingId: string; extensionId: string };
				const keybinding = this.findKeybinding(keybindingId, extensionId);
				if (keybinding) {
					await this.governanceService.approveKeybinding(keybinding);
				}
				break;
			}
			case 'deactivate': {
				const { keybindingId, extensionId } = message.data as { keybindingId: string; extensionId: string };
				const keybinding = this.findKeybinding(keybindingId, extensionId);
				if (keybinding) {
					await this.governanceService.applyDecision(keybinding, 'deactivate');
				}
				break;
			}
			case 'remap': {
				const { keybindingId, extensionId, newKey } = message.data as { keybindingId: string; extensionId: string; newKey: string };
				const keybinding = this.findKeybinding(keybindingId, extensionId);
				if (keybinding && newKey) {
					await this.governanceService.applyDecision(keybinding, 'remap', newKey);
				}
				break;
			}
			case 'skip': {
				const { keybindingId, extensionId } = message.data as { keybindingId: string; extensionId: string };
				const keybinding = this.findKeybinding(keybindingId, extensionId);
				if (keybinding) {
					await this.governanceService.skipKeybinding(keybinding);
				}
				break;
			}
			case 'approveAll': {
				const { extensionId } = message.data as { extensionId: string };
				await this.governanceService.approveAllFromExtension(extensionId);
				break;
			}
			case 'deactivateAll': {
				const { extensionId } = message.data as { extensionId: string };
				const confirmDeactivateAll = await vscode.window.showWarningMessage(
					vscode.l10n.t('This will deactivate all shortcuts from this extension. Continue?'),
					vscode.l10n.t('Yes'),
					vscode.l10n.t('No')
				);
				if (confirmDeactivateAll === vscode.l10n.t('Yes')) {
					await this.governanceService.deactivateAllFromExtension(extensionId);
				}
				break;
			}
			case 'restore': {
				const { keybindingId, extensionId } = message.data as { keybindingId: string; extensionId: string };
				const keybinding = this.findKeybinding(keybindingId, extensionId);
				if (keybinding) {
					await this.governanceService.restoreKeybinding(keybinding);
				}
				break;
			}
			case 'restoreAll': {
				const { extensionId } = message.data as { extensionId: string };
				await this.governanceService.restoreAllFromExtension(extensionId);
				break;
			}
			case 'unapprove': {
				const { keybindingId, extensionId } = message.data as { keybindingId: string; extensionId: string };
				const keybinding = this.findKeybinding(keybindingId, extensionId);
				if (keybinding) {
					await this.governanceService.unapproveKeybinding(keybinding);
				}
				break;
			}
			case 'unapproveAll': {
				const { extensionId } = message.data as { extensionId: string };
				await this.governanceService.unapproveAllFromExtension(extensionId);
				break;
			}
			case 'restoreRemap': {
				const { keybindingId, extensionId } = message.data as { keybindingId: string; extensionId: string };
				const keybinding = this.findKeybinding(keybindingId, extensionId);
				if (keybinding) {
					await this.governanceService.restoreRemappedKeybinding(keybinding);
				}
				break;
			}
			case 'deactivateAllConflicting': {
				const confirmDeactivateConflicting = await vscode.window.showWarningMessage(
					vscode.l10n.t('This will deactivate all conflicting extension shortcuts. Continue?'),
					vscode.l10n.t('Yes'),
					vscode.l10n.t('No')
				);
				if (confirmDeactivateConflicting === vscode.l10n.t('Yes')) {
					const { user, extension } = await this.parser.getAllKeybindings();
					const activeExtension = extension.filter(kb => {
						const status = this.governanceService.getStatus(kb.id);
						return status !== 'deactivated' && status !== 'remapped';
					});
					const conflicts = this.conflictService.detectConflicts(user, activeExtension);
					for (const conflict of conflicts) {
						for (const binding of conflict.bindings) {
							if (binding.source === 'extension') {
								await this.governanceService.applyDecision(binding, 'deactivate');
							}
						}
					}
				}
				break;
			}
			case 'createSnapshot': {
				await vscode.commands.executeCommand('harmonia-shortcuts.createSnapshot');
				break;
			}
			case 'restoreSnapshot': {
				await vscode.commands.executeCommand('harmonia-shortcuts.restoreSnapshot');
				break;
			}
			case 'openKeybindings': {
				await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
				break;
			}
			case 'refresh': {
				await this.refresh();
				break;
			}
			case 'exportSettings': {
				// Build a complete, human-readable backup of ALL shortcuts
				const allBindings = this.parser.getAllExtensionKeybindings();
				const governedBindings = this.governanceService.getGovernedKeybindings(allBindings);

				// Sanitize text to use regular dashes instead of em-dashes for compatibility
				const sanitize = (text: string | undefined) => text?.replace(/\u2014/g, '-').replace(/\u2013/g, '-');

				// Export ALL shortcuts with their current status
				const allShortcuts = governedBindings.map(kb => ({
					key: kb.key,
					command: kb.command,
					when: kb.when || undefined,
					extensionId: kb.extensionId,
					extensionName: sanitize(kb.extensionName),
					status: kb.status,
					...(kb.status === 'remapped' ? {
						originalKey: kb.originalKey,
						remappedKey: kb.remappedKey,
					} : {}),
				}));

				// Group by extension for readability
				const byExtension: Record<string, typeof allShortcuts> = {};
				for (const shortcut of allShortcuts) {
					const extName = sanitize(shortcut.extensionName || shortcut.extensionId || 'Unknown') || 'Unknown';
					if (!byExtension[extName]) {
						byExtension[extName] = [];
					}
					byExtension[extName].push(shortcut);
				}

				// Count by status for summary
				const summary = {
					total: allShortcuts.length,
					pending: allShortcuts.filter(s => s.status === 'pending').length,
					approved: allShortcuts.filter(s => s.status === 'approved').length,
					deactivated: allShortcuts.filter(s => s.status === 'deactivated').length,
					remapped: allShortcuts.filter(s => s.status === 'remapped').length,
					skipped: allShortcuts.filter(s => s.status === 'skipped').length,
				};

				const exportData = {
					version: 3,
					exportedAt: new Date().toISOString(),
					description: 'Harmonia Shortcuts - Complete backup of all extension shortcuts',
					summary,
					extensions: byExtension,
				};

				const uri = await vscode.window.showSaveDialog({
					defaultUri: vscode.Uri.file('harmonia-shortcuts-backup.json'),
					filters: { 'JSON': ['json'] },
					title: vscode.l10n.t('Export Shortcuts'),
				});

				if (uri) {
					const content = JSON.stringify(exportData, null, 2);
					await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
					vscode.window.showInformationMessage(
						vscode.l10n.t('Exported {0} shortcuts successfully.', allShortcuts.length.toString())
					);
				}
				break;
			}
			case 'importSettings': {
				const uris = await vscode.window.showOpenDialog({
					canSelectMany: false,
					filters: { 'JSON': ['json'] },
					title: vscode.l10n.t('Import Shortcuts'),
				});

				if (uris && uris.length > 0) {
					try {
						const content = await vscode.workspace.fs.readFile(uris[0]);
						const importData = JSON.parse(content.toString());

						// Support both v2 (flat array) and v3 (grouped by extension)
						let shortcuts: any[] = [];
						if (importData.version === 3 && importData.extensions) {
							// v3: flatten the extensions object
							for (const extShortcuts of Object.values(importData.extensions)) {
								shortcuts.push(...(extShortcuts as any[]));
							}
						} else if (importData.version === 2 && Array.isArray(importData.shortcuts)) {
							shortcuts = importData.shortcuts;
						} else {
							throw new Error('Invalid backup file format');
						}

						let appliedCount = 0;
						let skippedCount = 0;

						// Apply each shortcut from the backup
						for (const shortcut of shortcuts) {
							if (!shortcut.key || !shortcut.command || !shortcut.status) {
								skippedCount++;
								continue;
							}

							// Create a keybinding object from the backup data
							const kb: Keybinding = {
								id: this.generateKeybindingId(shortcut.key, shortcut.command, shortcut.when),
								key: shortcut.key,
								command: shortcut.command,
								when: shortcut.when,
								source: 'extension',
								extensionId: shortcut.extensionId,
								extensionName: shortcut.extensionName,
							};

							if (shortcut.status === 'deactivated') {
								await this.governanceService.applyDecision(kb, 'deactivate');
								appliedCount++;
							} else if (shortcut.status === 'remapped' && shortcut.remappedKey) {
								await this.governanceService.applyDecision(kb, 'remap', shortcut.remappedKey);
								appliedCount++;
							} else if (shortcut.status === 'approved') {
								await this.governanceService.approveKeybinding(kb);
								appliedCount++;
							} else if (shortcut.status === 'skipped') {
								await this.governanceService.skipKeybinding(kb);
								appliedCount++;
							} else if (shortcut.status === 'pending') {
								// Pending = no action needed, just skip silently
								appliedCount++;
							} else {
								skippedCount++;
							}
						}

						await this.refresh();

						if (skippedCount > 0) {
							vscode.window.showInformationMessage(
								vscode.l10n.t('Imported {0} shortcuts. {1} skipped.', appliedCount.toString(), skippedCount.toString())
							);
						} else {
							vscode.window.showInformationMessage(
								vscode.l10n.t('Imported {0} shortcuts successfully.', appliedCount.toString())
							);
						}
					} catch (error) {
						vscode.window.showErrorMessage(
							vscode.l10n.t('Failed to import. Invalid file format.')
						);
					}
				}
				break;
			}
		}
	}

	private findKeybindingById(keybindingId: string): Keybinding | undefined {
		const allBindings = this.parser.getAllExtensionKeybindings();
		return allBindings.find(k => k.id === keybindingId);
	}

	private generateKeybindingId(key: string, command: string, when?: string): string {
		const raw = `${key}|${command}|${when ?? ''}`;
		// Simple hash function
		let hash = 0;
		for (let i = 0; i < raw.length; i++) {
			const char = raw.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash;
		}
		return Math.abs(hash).toString(16).substring(0, 16);
	}

	private findKeybinding(keybindingId: string, extensionId: string): Keybinding | undefined {
		const keybindings = this.parser.getKeybindingsForExtension(extensionId);
		return keybindings.find(k => k.id === keybindingId);
	}

	private getHtml(webview: vscode.Webview, data: AuditData): string {
		const nonce = this.getNonce();
		const t = vscode.l10n.t;

		// Codicon font from bundled media
		const codiconsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'codicon.css')
		);

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<link href="${codiconsUri}" rel="stylesheet" />
	<title>Shortcuts Audit</title>
	<style>
		* {
			box-sizing: border-box;
			margin: 0;
			padding: 0;
		}

		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			padding: 24px;
			line-height: 1.6;
			max-width: 1200px;
			margin: 0 auto;
		}

		/* Header */
		.header {
			margin-bottom: 24px;
		}

		.header h1 {
			font-size: 1.5em;
			font-weight: 600;
			margin-bottom: 8px;
		}

		.header-description {
			color: var(--vscode-descriptionForeground);
			margin-bottom: 16px;
		}

		.header-actions {
			display: flex;
			gap: 8px;
			flex-wrap: wrap;
		}

		/* Buttons */
		.btn {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: 1px solid var(--vscode-panel-border);
			padding: 6px 12px;
			border-radius: 4px;
			cursor: pointer;
			font-size: 12px;
			display: inline-flex;
			align-items: center;
			gap: 6px;
			white-space: nowrap;
			transition: background 0.15s, border-color 0.15s, color 0.15s;
		}

		.btn:hover {
			background: var(--vscode-button-secondaryHoverBackground);
			border-color: var(--vscode-focusBorder);
		}

		.btn .codicon {
			font-size: 14px;
		}

		.btn-primary {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border-color: var(--vscode-button-background);
		}

		.btn-primary:hover {
			background: var(--vscode-button-hoverBackground);
			border-color: var(--vscode-button-hoverBackground);
		}

		/* Approve All: accent style */
		.btn-success {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border-color: var(--vscode-button-background);
		}

		.btn-success:hover {
			background: var(--vscode-button-hoverBackground);
			border-color: var(--vscode-button-hoverBackground);
		}

		/* Deactivate All: secondary style - readable across all themes */
		.btn-danger {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border-color: var(--vscode-button-secondaryBackground);
		}

		.btn-danger:hover {
			background: var(--vscode-button-secondaryHoverBackground);
			border-color: var(--vscode-button-secondaryHoverBackground);
		}

		.btn-small {
			padding: 4px 10px;
			font-size: 11px;
		}

		.btn-small .codicon {
			font-size: 12px;
		}

		/* Stats */
		.stats-row {
			display: flex;
			gap: 16px;
			margin-bottom: 24px;
			flex-wrap: wrap;
		}

		.stat-item {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 8px 12px;
			background: var(--vscode-sideBar-background);
			border-radius: 4px;
			font-size: 13px;
		}

		.stat-value {
			font-weight: 600;
		}

		.stat-pending .stat-value { color: var(--vscode-textLink-foreground); }
		.stat-approved .stat-value { color: var(--vscode-foreground); }
		.stat-deactivated .stat-value { color: var(--vscode-descriptionForeground); }

		/* Sections */
		.section {
			margin-bottom: 32px;
		}

		.section-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 12px;
			padding-bottom: 8px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}

		.section-title {
			font-size: 1.1em;
			font-weight: 600;
		}

		.section-actions {
			display: flex;
			gap: 8px;
		}

		/* Conflicts */
		.conflict-card {
			background: var(--vscode-sideBar-background);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			padding: 16px;
			margin-bottom: 12px;
		}

		.conflict-header {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-bottom: 12px;
		}

		.conflict-card:not(.conflict-card-static) .conflict-header {
			cursor: pointer;
			margin-bottom: 0;
		}

		.conflict-toggle {
			width: 20px;
			height: 20px;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 12px;
			transition: transform 0.15s;
		}

		.conflict-card.expanded .conflict-toggle {
			transform: rotate(90deg);
		}

		.conflict-key {
			font-family: var(--vscode-editor-font-family);
			font-size: 1.1em;
			font-weight: 600;
			background: var(--vscode-textCodeBlock-background);
			padding: 4px 10px;
			border-radius: 4px;
		}

		.conflict-bindings {
			margin-top: 8px;
		}

		.conflict-card:not(.conflict-card-static) .conflict-bindings {
			display: none;
			border-top: 1px solid var(--vscode-panel-border);
			margin-top: 12px;
			padding-top: 12px;
		}

		.conflict-card.expanded .conflict-bindings {
			display: block;
		}

		.conflict-binding {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 8px 12px;
			background: var(--vscode-editor-background);
			border-radius: 4px;
			margin-bottom: 6px;
		}

		.conflict-binding:last-child {
			margin-bottom: 0;
		}

		.conflict-binding-info {
			flex: 1;
		}

		.conflict-command {
			font-family: var(--vscode-editor-font-family);
			font-size: 12px;
			color: var(--vscode-foreground);
		}

		.conflict-source {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			margin-top: 2px;
		}

		.conflict-source-user {
			color: var(--vscode-textLink-foreground);
		}

		.conflict-actions {
			display: flex;
			gap: 4px;
		}

		/* Extension Cards */
		.extension-card {
			background: var(--vscode-sideBar-background);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			margin-bottom: 12px;
			overflow: hidden;
		}

		.extension-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 12px 16px;
			cursor: pointer;
			user-select: none;
		}

		.extension-header:hover {
			background: var(--vscode-list-hoverBackground);
		}

		.extension-title {
			display: flex;
			align-items: center;
			gap: 10px;
		}

		.extension-name {
			font-weight: 500;
			display: inline-flex;
			align-items: center;
			gap: 6px;
		}

		.extension-name .codicon {
			font-size: 14px;
		}

		.extension-toggle {
			width: 20px;
			height: 20px;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 12px;
			transition: transform 0.15s;
		}

		.extension-card.expanded .extension-toggle {
			transform: rotate(90deg);
		}

		.extension-meta {
			display: flex;
			align-items: center;
			gap: 12px;
		}

		.extension-count {
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			display: flex;
			align-items: center;
			gap: 8px;
		}

		.extension-count .codicon {
			font-size: 12px;
		}

		.extension-badge {
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			padding: 2px 8px;
			border-radius: 10px;
			font-size: 11px;
			font-weight: 500;
		}

		.extension-actions {
			display: flex;
			gap: 6px;
		}

		.extension-body {
			display: none;
			border-top: 1px solid var(--vscode-panel-border);
		}

		.extension-card.expanded .extension-body {
			display: block;
		}

		/* Keybinding rows */
		.keybinding-row {
			display: grid;
			grid-template-columns: 140px 1fr auto auto;
			align-items: center;
			padding: 10px 16px;
			gap: 16px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}

		.keybinding-row:last-child {
			border-bottom: none;
		}

		.keybinding-row:hover {
			background: var(--vscode-list-hoverBackground);
		}

		.keybinding-row.decided {
			opacity: 0.8;
		}

		.keybinding-key {
			display: flex;
			align-items: center;
			gap: 8px;
		}

		.keybinding-status {
			min-width: 70px;
			text-align: right;
		}

		.key-combo {
			font-family: var(--vscode-editor-font-family);
			background: var(--vscode-textCodeBlock-background);
			padding: 4px 8px;
			border-radius: 4px;
			font-size: 12px;
		}

		.keybinding-command {
			font-family: var(--vscode-editor-font-family);
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.keybinding-actions {
			display: flex;
			gap: 4px;
		}

		.action-btn {
			background: transparent;
			border: 1px solid var(--vscode-panel-border);
			color: var(--vscode-foreground);
			padding: 4px 10px;
			border-radius: 4px;
			cursor: pointer;
			font-size: 11px;
			display: flex;
			align-items: center;
			gap: 5px;
			transition: background 0.15s, border-color 0.15s, color 0.15s;
		}

		.action-btn .codicon {
			font-size: 14px;
		}

		/* Approve: solid accent - the positive primary action */
		.action-btn.approve {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border-color: var(--vscode-button-background);
		}

		.action-btn.approve:hover {
			background: var(--vscode-button-hoverBackground);
			border-color: var(--vscode-button-hoverBackground);
		}

		/* Deactivate: secondary style - readable across all themes */
		.action-btn.deactivate {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border-color: var(--vscode-button-secondaryBackground);
		}

		.action-btn.deactivate:hover {
			background: var(--vscode-button-secondaryHoverBackground);
			border-color: var(--vscode-button-secondaryHoverBackground);
		}

		/* Remap: outlined with link color - a neutral change action */
		.action-btn.remap {
			border-color: var(--vscode-textLink-foreground);
			color: var(--vscode-textLink-foreground);
		}

		.action-btn.remap:hover {
			background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent);
		}

		/* Generic action buttons (restore, undo) */
		.action-btn:not(.approve):not(.deactivate):not(.remap):hover {
			background: var(--vscode-toolbar-hoverBackground);
			border-color: var(--vscode-focusBorder);
		}

		/* Status badges */
		.status-badge {
			font-size: 10px;
			padding: 2px 8px;
			border-radius: 3px;
			text-transform: uppercase;
			font-weight: 600;
			letter-spacing: 0.5px;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
		}

		.status-approved {
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
		}

		.status-deactivated {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-descriptionForeground);
		}

		.status-remapped {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}

		.status-skipped {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-descriptionForeground);
		}

		/* User shortcuts section */
		.user-section {
			/* Full opacity - user shortcuts are important */
		}

		.user-note {
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			font-style: italic;
			margin-bottom: 12px;
		}

		.priority-note {
			font-size: 12px;
			padding: 12px 16px;
			background: var(--vscode-sideBar-background);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			margin-bottom: 12px;
			color: var(--vscode-foreground);
		}

		.priority-note strong {
			color: var(--vscode-textLink-foreground);
		}

		/* Empty states */
		.empty-state {
			text-align: center;
			padding: 32px;
			color: var(--vscode-descriptionForeground);
		}

		.success-state {
			text-align: center;
			padding: 24px;
			background: color-mix(in srgb, var(--vscode-testing-iconPassed) 10%, var(--vscode-editor-background));
			border: 1px solid var(--vscode-testing-iconPassed);
			border-radius: 6px;
			color: var(--vscode-testing-iconPassed);
		}

		/* Tooltips */
		[title] {
			position: relative;
		}

		/* Remap Modal */
		.modal-overlay {
			display: none;
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background: rgba(0, 0, 0, 0.6);
			z-index: 1000;
			align-items: center;
			justify-content: center;
		}

		.modal-overlay.visible {
			display: flex;
		}

		.modal {
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 8px;
			padding: 24px;
			min-width: 400px;
			max-width: 500px;
			box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		}

		.modal-header {
			margin-bottom: 16px;
		}

		.modal-title {
			font-size: 1.2em;
			font-weight: 600;
			margin-bottom: 4px;
		}

		.modal-subtitle {
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		}

		.modal-body {
			margin-bottom: 20px;
		}

		.key-capture-area {
			background: var(--vscode-input-background);
			border: 2px solid var(--vscode-focusBorder);
			border-radius: 6px;
			padding: 20px;
			text-align: center;
			min-height: 80px;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 8px;
		}

		.key-capture-area:focus {
			outline: none;
			border-color: var(--vscode-textLink-foreground);
		}

		.captured-key {
			font-family: var(--vscode-editor-font-family);
			font-size: 1.5em;
			font-weight: 600;
			background: var(--vscode-textCodeBlock-background);
			padding: 8px 16px;
			border-radius: 6px;
			min-width: 100px;
		}

		.capture-hint {
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		}

		.modal-footer {
			display: flex;
			justify-content: flex-end;
			gap: 8px;
		}

		.modal-info {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			margin-bottom: 16px;
			padding: 8px 12px;
			background: var(--vscode-sideBar-background);
			border-radius: 4px;
		}

		/* Settings bar */
		.settings-bar {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 16px;
			padding: 12px 16px;
			background: var(--vscode-sideBar-background);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			margin-bottom: 24px;
			flex-wrap: wrap;
		}

		.settings-left {
			display: flex;
			align-items: center;
			gap: 16px;
			flex-wrap: wrap;
		}

		.settings-right {
			display: flex;
			align-items: center;
			gap: 8px;
		}

		@media (prefers-reduced-motion: reduce) {
			* {
				transition: none !important;
			}
		}
	</style>
</head>
<body>
	<div class="header">
		<h1>${t('Shortcuts Audit')}</h1>
		<p class="header-description">
			${t('Review and manage keyboard shortcuts from your installed extensions. Approve shortcuts you want to keep, deactivate ones that conflict with your workflow, or remap them to different keys.')}
		</p>
		<div class="header-actions">
			<button class="btn btn-primary" data-action="refresh" title="${t('Refresh the audit')}">
				<i class="codicon codicon-refresh"></i> ${t('Refresh')}
			</button>
			<button class="btn" data-action="exportSettings" title="${t('Export all shortcuts to file')}">
				<i class="codicon codicon-cloud-download"></i> ${t('Export')}
			</button>
			<button class="btn" data-action="importSettings" title="${t('Import shortcuts from file')}">
				<i class="codicon codicon-cloud-upload"></i> ${t('Import')}
			</button>
			<button class="btn" data-action="openKeybindings" title="${t('Open keybindings.json')}">
				<i class="codicon codicon-json"></i> ${t('keybindings.json')}
			</button>
		</div>
	</div>

	<div class="settings-bar">
		<div class="settings-left">
			<span class="stat-item">
				<span class="stat-label">${t('Total')}:</span>
				<span class="stat-value">${data.stats.total}</span>
			</span>
			<span class="stat-item stat-pending">
				<span class="stat-label">${t('Unreviewed')}:</span>
				<span class="stat-value">${data.stats.pending}</span>
			</span>
		</div>
	</div>

	<div class="stats-row">
		<div class="stat-item stat-approved">
			<span class="stat-label">${t('Approved')}:</span>
			<span class="stat-value">${data.stats.approved}</span>
		</div>
		<div class="stat-item stat-deactivated">
			<span class="stat-label">${t('Deactivated')}:</span>
			<span class="stat-value">${data.stats.deactivated}</span>
		</div>
		<div class="stat-item">
			<span class="stat-label">${t('Remapped')}:</span>
			<span class="stat-value">${data.stats.remapped}</span>
		</div>
	</div>

	${data.stats.pending === 0 && data.stats.conflicts === 0 ? `
		<div class="success-state">
			<strong>${t('All clear!')}</strong> ${t('All extension shortcuts have been reviewed.')}
		</div>
	` : ''}

	${data.conflicts.length > 0 ? `
	<div class="section">
		<div class="section-header">
			<span class="section-title">${vscode.l10n.t('Conflicts')} (${data.conflicts.length})</span>
			<div class="section-actions">
				<button class="btn btn-danger btn-small" data-action="deactivateAllConflicting">
					<i class="codicon codicon-close-all"></i> ${vscode.l10n.t('Deactivate All Extension Conflicts')}
				</button>
			</div>
		</div>
		<p class="user-note">${vscode.l10n.t('These keys are used by multiple shortcuts. Review each conflict and decide which one to keep.')}</p>
		${data.conflicts.map(conflict => {
			const collapsible = conflict.bindings.length >= 3;
			return `
			<div class="conflict-card${collapsible ? '' : ' conflict-card-static'}">
				<div class="conflict-header"${collapsible ? ' data-toggle-conflict' : ''}>
					${collapsible ? '<i class="conflict-toggle codicon codicon-chevron-right"></i>' : ''}
					<span class="conflict-key">${this.escapeHtml(conflict.key)}</span>
					${collapsible ? `<span class="extension-badge">${conflict.bindings.length} ${vscode.l10n.t('bindings')}</span>` : ''}
				</div>
				<div class="conflict-bindings">
					${conflict.bindings.map(b => `
						<div class="conflict-binding">
							<div class="conflict-binding-info">
								<div class="conflict-command">${this.escapeHtml(b.command)}</div>
								<div class="conflict-source ${b.source === 'user' ? 'conflict-source-user' : ''}">
									${b.source === 'user'
										? `<i class="codicon codicon-lock"></i> ${vscode.l10n.t('Your shortcut (protected)')}`
										: `<i class="codicon codicon-extensions"></i> ${this.escapeHtml(b.extensionName || b.extensionId || 'Extension')}`
									}
								</div>
							</div>
							${b.source === 'extension' ? `
								<div class="conflict-actions">
									<button class="action-btn remap" data-action="remap" data-keybinding-id="${this.escapeHtml(b.id)}" data-extension-id="${this.escapeHtml(b.extensionId || '')}" title="${vscode.l10n.t('Change to a different key')}">
										<i class="codicon codicon-arrow-swap"></i> ${vscode.l10n.t('Remap')}
									</button>
									<button class="action-btn deactivate" data-action="deactivate" data-keybinding-id="${this.escapeHtml(b.id)}" data-extension-id="${this.escapeHtml(b.extensionId || '')}" title="${vscode.l10n.t('Deactivate this shortcut')}">
										<i class="codicon codicon-close"></i> ${vscode.l10n.t('Deactivate')}
									</button>
								</div>
							` : ''}
						</div>
					`).join('')}
				</div>
			</div>`;
		}).join('')}
	</div>
	` : ''}

	${data.stats.pending > 0 ? `
	<div class="section">
		<div class="section-header">
			<span class="section-title">${vscode.l10n.t('Unreviewed')} (${data.stats.pending})</span>
		</div>
		<p class="user-note">${vscode.l10n.t('These extension shortcuts have not been reviewed yet. Click on an extension to see its shortcuts.')}</p>

		${data.extensionGroups.filter(g => g.stats.pending > 0).sort((a, b) => b.stats.pending - a.stats.pending).map(group => `
			<div class="extension-card" data-extension="${this.escapeHtml(group.id)}">
				<div class="extension-header" data-toggle-card>
					<div class="extension-title">
						<i class="extension-toggle codicon codicon-chevron-right"></i>
						<span class="extension-name">${this.escapeHtml(group.name)}</span>
						<span class="extension-badge">${group.stats.pending} ${vscode.l10n.t('unreviewed')}</span>
					</div>
					<div class="extension-meta">
						<span class="extension-count">${group.keybindings.length} ${vscode.l10n.t('shortcuts')}</span>
						<div class="extension-actions">
							<button class="btn btn-success btn-small" data-action="approveAll" data-extension-id="${this.escapeHtml(group.id)}">
								<i class="codicon codicon-check-all"></i> ${vscode.l10n.t('Approve All')}
							</button>
							<button class="btn btn-danger btn-small" data-action="deactivateAll" data-extension-id="${this.escapeHtml(group.id)}">
								<i class="codicon codicon-close-all"></i> ${vscode.l10n.t('Deactivate All')}
							</button>
						</div>
					</div>
				</div>
				<div class="extension-body">
					${group.keybindings.filter(kb => kb.status === 'pending').map(kb => `
						<div class="keybinding-row">
							<div class="keybinding-key">
								<span class="key-combo">${this.escapeHtml(kb.key)}</span>
							</div>
							<div class="keybinding-command" title="${this.escapeHtml(kb.command)}">${this.escapeHtml(kb.command)}</div>
							<div class="keybinding-actions">
								<button class="action-btn remap" data-action="remap" data-keybinding-id="${this.escapeHtml(kb.id)}" data-extension-id="${this.escapeHtml(group.id)}" title="${vscode.l10n.t('Change to a different key')}">
									<i class="codicon codicon-arrow-swap"></i> ${vscode.l10n.t('Remap')}
								</button>
								<button class="action-btn approve" data-action="approve" data-keybinding-id="${this.escapeHtml(kb.id)}" data-extension-id="${this.escapeHtml(group.id)}" title="${vscode.l10n.t('Keep this shortcut active')}">
									<i class="codicon codicon-check"></i> ${vscode.l10n.t('Approve')}
								</button>
								<button class="action-btn deactivate" data-action="deactivate" data-keybinding-id="${this.escapeHtml(kb.id)}" data-extension-id="${this.escapeHtml(group.id)}" title="${vscode.l10n.t('Disable this shortcut')}">
									<i class="codicon codicon-close"></i> ${vscode.l10n.t('Deactivate')}
								</button>
							</div>
						</div>
					`).join('')}
				</div>
			</div>
		`).join('')}
	</div>
	` : ''}

	${data.extensionGroups.some(g => g.stats.approved > 0 || g.stats.deactivated > 0 || g.stats.remapped > 0) ? `
	<div class="section">
		<div class="section-header">
			<span class="section-title">${vscode.l10n.t('Reviewed')}</span>
		</div>
		<p class="user-note">${vscode.l10n.t('Shortcuts you have already reviewed. You can restore deactivated shortcuts to make them available for review again.')}</p>

		${data.extensionGroups.filter(g => g.stats.approved > 0 || g.stats.deactivated > 0 || g.stats.remapped > 0).map(group => {
			const reviewedBindings = group.keybindings.filter(kb => kb.status !== 'pending');
			if (reviewedBindings.length === 0) return '';
			return `
			<div class="extension-card" data-extension="${this.escapeHtml(group.id)}-reviewed">
				<div class="extension-header" data-toggle-card>
					<div class="extension-title">
						<i class="extension-toggle codicon codicon-chevron-right"></i>
						<span class="extension-name">${this.escapeHtml(group.name)}</span>
					</div>
					<div class="extension-meta">
						<span class="extension-count">
							${group.stats.approved > 0 ? `<i class="codicon codicon-check"></i> ${group.stats.approved}` : ''}
							${group.stats.deactivated > 0 ? `<i class="codicon codicon-close"></i> ${group.stats.deactivated}` : ''}
							${group.stats.remapped > 0 ? `<i class="codicon codicon-arrow-swap"></i> ${group.stats.remapped}` : ''}
						</span>
						${group.stats.approved > 0 || group.stats.deactivated > 0 ? `
						<div class="extension-actions">
							${group.stats.approved > 0 ? `
							<button class="btn btn-small" data-action="unapproveAll" data-extension-id="${this.escapeHtml(group.id)}" title="${vscode.l10n.t('Send all approved shortcuts back to unreviewed')}">
								${vscode.l10n.t('Review Again')}
							</button>
							` : ''}
							${group.stats.deactivated > 0 ? `
							<button class="btn btn-small" data-action="restoreAll" data-extension-id="${this.escapeHtml(group.id)}" title="${vscode.l10n.t('Restore all deactivated shortcuts')}">
								${vscode.l10n.t('Restore All')}
							</button>
							` : ''}
						</div>
						` : ''}
					</div>
				</div>
				<div class="extension-body">
					${reviewedBindings.map(kb => `
						<div class="keybinding-row decided">
							<div class="keybinding-key">
								<span class="key-combo">${this.escapeHtml(kb.remappedKey || kb.key)}</span>
							</div>
							<div class="keybinding-command" title="${this.escapeHtml(kb.command)}">${this.escapeHtml(kb.command)}</div>
							<div class="keybinding-status">
								${this.getStatusBadge(kb.status)}
							</div>
							<div class="keybinding-actions">
								${kb.status === 'approved' ? `
								<button class="action-btn" data-action="unapprove" data-keybinding-id="${this.escapeHtml(kb.id)}" data-extension-id="${this.escapeHtml(group.id)}" title="${vscode.l10n.t('Mark as unreviewed')}">
									<i class="codicon codicon-discard"></i> ${vscode.l10n.t('Undo')}
								</button>
								` : ''}
								${kb.status === 'deactivated' ? `
								<button class="action-btn" data-action="restore" data-keybinding-id="${this.escapeHtml(kb.id)}" data-extension-id="${this.escapeHtml(group.id)}" title="${vscode.l10n.t('Restore this shortcut')}">
									<i class="codicon codicon-history"></i> ${vscode.l10n.t('Restore')}
								</button>
								` : ''}
								${kb.status === 'remapped' ? `
								<button class="action-btn remap" data-action="remap" data-keybinding-id="${this.escapeHtml(kb.id)}" data-extension-id="${this.escapeHtml(group.id)}" title="${vscode.l10n.t('Change the remapped key')}">
									<i class="codicon codicon-arrow-swap"></i> ${vscode.l10n.t('Change')}
								</button>
								<button class="action-btn" data-action="restoreRemap" data-keybinding-id="${this.escapeHtml(kb.id)}" data-extension-id="${this.escapeHtml(group.id)}" title="${vscode.l10n.t('Remove remap and mark as unreviewed')}">
									<i class="codicon codicon-discard"></i> ${vscode.l10n.t('Undo')}
								</button>
								` : ''}
							</div>
						</div>
					`).join('')}
				</div>
			</div>
		`}).join('')}
	</div>
	` : ''}

	${data.userKeybindings.length > 0 ? `
	<div class="section user-section">
		<div class="section-header">
			<span class="section-title">${vscode.l10n.t('Your Shortcuts')} (${data.userKeybindings.length})</span>
		</div>
		<div class="priority-note">
			<strong>${vscode.l10n.t('Priority: Your shortcuts always win.')}</strong>
			${vscode.l10n.t('VS Code loads your keybindings.json last, so your custom shortcuts override any extension shortcuts using the same key.')}
		</div>
		<div class="extension-card">
			<div class="extension-header" data-toggle-card>
				<div class="extension-title">
					<i class="extension-toggle codicon codicon-chevron-right"></i>
					<span class="extension-name"><i class="codicon codicon-lock"></i> ${vscode.l10n.t('Custom Keybindings')}</span>
				</div>
				<div class="extension-meta">
					<span class="extension-count">${data.userKeybindings.length} ${vscode.l10n.t('shortcuts')}</span>
				</div>
			</div>
			<div class="extension-body">
				${data.userKeybindings.map(kb => `
					<div class="keybinding-row">
						<div class="keybinding-key">
							<span class="key-combo">${this.escapeHtml(kb.key)}</span>
						</div>
						<div class="keybinding-command" title="${this.escapeHtml(kb.command)}">${this.escapeHtml(kb.command)}</div>
						<div class="keybinding-actions"></div>
					</div>
				`).join('')}
			</div>
		</div>
	</div>
	` : ''}

	<!-- Remap Modal -->
	<div class="modal-overlay" id="remapModal">
		<div class="modal">
			<div class="modal-header">
				<div class="modal-title">${vscode.l10n.t('Remap Shortcut')}</div>
				<div class="modal-subtitle" id="remapCommand"></div>
			</div>
			<div class="modal-body">
				<div class="modal-info">
					${vscode.l10n.t('Press the key combination you want to use. Press Esc to cancel.')}
				</div>
				<div class="key-capture-area" id="keyCaptureArea" tabindex="0">
					<div class="captured-key" id="capturedKey">${vscode.l10n.t('Press a key...')}</div>
					<div class="capture-hint" id="captureHint">${vscode.l10n.t('Waiting for input')}</div>
				</div>
			</div>
			<div class="modal-footer">
				<button class="btn" id="cancelRemap">${vscode.l10n.t('Cancel')}</button>
				<button class="btn btn-primary" id="confirmRemap" disabled>${vscode.l10n.t('Confirm')}</button>
			</div>
		</div>
	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();

		function send(command, data) {
			vscode.postMessage({ command, data });
		}

		function toggleCard(card) {
			const section = card.closest('.section');
			const wasExpanded = card.classList.contains('expanded');
			const cardClass = card.classList.contains('conflict-card') ? '.conflict-card.expanded' : '.extension-card.expanded';

			// Close all cards of the same type in the same section (accordion behavior)
			if (section) {
				section.querySelectorAll(cardClass).forEach(c => {
					c.classList.remove('expanded');
				});
			}

			// Toggle the clicked card
			if (!wasExpanded) {
				card.classList.add('expanded');
			}
		}

		// Remap modal state
		let remapState = {
			keybindingId: null,
			extensionId: null,
			capturedKey: null
		};

		const remapModal = document.getElementById('remapModal');
		const keyCaptureArea = document.getElementById('keyCaptureArea');
		const capturedKeyDisplay = document.getElementById('capturedKey');
		const captureHint = document.getElementById('captureHint');
		const confirmBtn = document.getElementById('confirmRemap');
		const cancelBtn = document.getElementById('cancelRemap');
		const remapCommandDisplay = document.getElementById('remapCommand');

		function showRemapModal(keybindingId, extensionId, currentKey, command) {
			remapState = { keybindingId, extensionId, capturedKey: null };
			remapCommandDisplay.textContent = command;
			capturedKeyDisplay.textContent = currentKey || '${vscode.l10n.t('Press a key...')}';
			captureHint.textContent = '${vscode.l10n.t('Waiting for input')}';
			confirmBtn.disabled = true;
			remapModal.classList.add('visible');
			keyCaptureArea.focus();
		}

		function hideRemapModal() {
			remapModal.classList.remove('visible');
			remapState = { keybindingId: null, extensionId: null, capturedKey: null };
		}

		function buildKeyString(e) {
			const parts = [];

			// Modifiers in VS Code order
			if (e.ctrlKey) parts.push('ctrl');
			if (e.shiftKey) parts.push('shift');
			if (e.altKey) parts.push('alt');
			if (e.metaKey) parts.push('cmd');

			// Get the key
			let key = e.key.toLowerCase();

			// Map special keys
			const keyMap = {
				'control': null,
				'shift': null,
				'alt': null,
				'meta': null,
				' ': 'space',
				'arrowup': 'up',
				'arrowdown': 'down',
				'arrowleft': 'left',
				'arrowright': 'right',
				'escape': 'escape',
				'enter': 'enter',
				'tab': 'tab',
				'backspace': 'backspace',
				'delete': 'delete',
				'insert': 'insert',
				'home': 'home',
				'end': 'end',
				'pageup': 'pageup',
				'pagedown': 'pagedown',
				'capslock': 'capslock',
				'numlock': 'numlock',
				'scrolllock': 'scrolllock',
				'pause': 'pause',
				'contextmenu': 'contextmenu',
			};

			if (key in keyMap) {
				key = keyMap[key];
			}

			// Skip if it's just a modifier key
			if (key === null) {
				return null;
			}

			parts.push(key);
			return parts.join('+');
		}

		keyCaptureArea.addEventListener('keydown', function(e) {
			e.preventDefault();
			e.stopPropagation();

			const noModifiers = !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;

			// Escape cancels (always)
			if (e.key === 'Escape' && noModifiers) {
				hideRemapModal();
				return;
			}

			// Backspace alone clears the captured key to start over
			if (e.key === 'Backspace' && noModifiers && remapState.capturedKey) {
				remapState.capturedKey = null;
				capturedKeyDisplay.textContent = '${vscode.l10n.t('Press a key...')}';
				captureHint.textContent = '${vscode.l10n.t('Waiting for input')}';
				confirmBtn.disabled = true;
				return;
			}

			// Enter alone confirms if we already have a captured key
			// (Enter with modifiers like Ctrl+Enter will be captured as a new key)
			if (e.key === 'Enter' && noModifiers && remapState.capturedKey) {
				confirmRemap();
				return;
			}

			const keyString = buildKeyString(e);

			if (keyString) {
				if (remapState.capturedKey) {
					// Append as chord (e.g., "cmd+k cmd+k")
					remapState.capturedKey = remapState.capturedKey + ' ' + keyString;
				} else {
					remapState.capturedKey = keyString;
				}
				capturedKeyDisplay.textContent = remapState.capturedKey;
				captureHint.textContent = '${vscode.l10n.t('Press Enter to confirm, another key for chord, or Backspace to clear')}';
				confirmBtn.disabled = false;
			}
		});

		function confirmRemap() {
			if (remapState.capturedKey && remapState.keybindingId) {
				send('remap', {
					keybindingId: remapState.keybindingId,
					extensionId: remapState.extensionId,
					newKey: remapState.capturedKey
				});
				hideRemapModal();
			}
		}

		confirmBtn.addEventListener('click', confirmRemap);
		cancelBtn.addEventListener('click', hideRemapModal);

		// Close modal on overlay click
		remapModal.addEventListener('click', function(e) {
			if (e.target === remapModal) {
				hideRemapModal();
			}
		});

		// Event delegation for all interactions
		document.addEventListener('click', function(e) {
			const target = e.target;

			// Handle action buttons
			const actionBtn = target.closest('[data-action]');
			if (actionBtn) {
				e.stopPropagation();
				const action = actionBtn.dataset.action;
				const keybindingId = actionBtn.dataset.keybindingId;
				const extensionId = actionBtn.dataset.extensionId;

				// Special handling for remap - show modal instead
				if (action === 'remap' && keybindingId) {
					const row = actionBtn.closest('.keybinding-row') || actionBtn.closest('.conflict-binding');
					const keyEl = row ? row.querySelector('.key-combo, .conflict-key') : null;
					const cmdEl = row ? row.querySelector('.keybinding-command, .conflict-command') : null;
					const currentKey = keyEl ? keyEl.textContent : '';
					const command = cmdEl ? cmdEl.textContent : '';
					showRemapModal(keybindingId, extensionId, currentKey, command);
					return;
				}

				if (keybindingId) {
					send(action, { keybindingId, extensionId });
				} else if (extensionId) {
					send(action, { extensionId });
				} else {
					send(action);
				}
				return;
			}

			// Handle card toggle (accordion)
			const toggleHeader = target.closest('[data-toggle-card]');
			if (toggleHeader) {
				const card = toggleHeader.closest('.extension-card');
				if (card) {
					toggleCard(card);
				}
				return;
			}

			// Handle conflict card toggle
			const conflictToggle = target.closest('[data-toggle-conflict]');
			if (conflictToggle) {
				const card = conflictToggle.closest('.conflict-card');
				if (card) {
					toggleCard(card);
				}
				return;
			}
		});

		// Auto-expand first card with pending items
		(function() {
			const firstPending = document.querySelector('.section:not(.user-section) .extension-card');
			if (firstPending) {
				firstPending.classList.add('expanded');
			}
		})();
	</script>
</body>
</html>`;
	}

	private getStatusBadge(status: GovernanceStatus): string {
		switch (status) {
			case 'approved':
				return `<span class="status-badge status-approved">${vscode.l10n.t('Approved')}</span>`;
			case 'deactivated':
				return `<span class="status-badge status-deactivated">${vscode.l10n.t('Off')}</span>`;
			case 'remapped':
				return `<span class="status-badge status-remapped">${vscode.l10n.t('Remapped')}</span>`;
			case 'skipped':
				return `<span class="status-badge status-skipped">${vscode.l10n.t('Skipped')}</span>`;
			default:
				return '';
		}
	}

	private escapeHtml(str: string): string {
		return str
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	private getNonce(): string {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}

	public dispose(): void {
		this.panel?.dispose();
		this.disposables.forEach(d => d.dispose());
	}
}
