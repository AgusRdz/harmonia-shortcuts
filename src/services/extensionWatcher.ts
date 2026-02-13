import * as vscode from 'vscode';
import { NewShortcutsNotification } from '../types';
import { GovernanceService } from './governanceService';
import { KeybindingParser } from './keybindingParser';
import { AuditPanelProvider } from '../providers/auditPanelProvider';

/**
 * Service for monitoring extension changes and detecting new keybindings
 */
export class ExtensionWatcher implements vscode.Disposable {
	private disposable: vscode.Disposable;
	private readonly _onNewShortcuts = new vscode.EventEmitter<NewShortcutsNotification[]>();
	readonly onNewShortcuts = this._onNewShortcuts.event;

	constructor(
		private readonly governanceService: GovernanceService,
		private readonly parser: KeybindingParser,
		private readonly auditPanel: AuditPanelProvider
	) {
		this.disposable = vscode.extensions.onDidChange(() => {
			this.checkForNewShortcuts();
		});
	}

	/**
	 * Checks for new shortcuts from installed/updated extensions
	 */
	async checkForNewShortcuts(): Promise<void> {
		const config = vscode.workspace.getConfiguration('harmonia-shortcuts');
		const notifyOnNew = config.get<boolean>('notifyOnNewShortcuts', true);

		if (!notifyOnNew) {
			return;
		}

		const newOrUpdated = this.governanceService.getNewOrUpdatedExtensions();

		if (newOrUpdated.length === 0) {
			return;
		}

		const notifications: NewShortcutsNotification[] = [];

		for (const { extensionId } of newOrUpdated) {
			const keybindings = this.parser.getKeybindingsForExtension(extensionId);
			const newKeybindings = keybindings.filter(
				kb => this.governanceService.getStatus(kb.id) === 'pending'
			);

			if (newKeybindings.length > 0) {
				const extension = vscode.extensions.getExtension(extensionId);
				notifications.push({
					extensionId,
					extensionName: extension?.packageJSON?.displayName || extensionId,
					newCount: newKeybindings.length,
					keybindingIds: newKeybindings.map(kb => kb.id),
				});
			}
		}

		if (notifications.length > 0) {
			this._onNewShortcuts.fire(notifications);
			await this.showNotification(notifications);
		}

		// Update stored versions
		const currentVersions = this.parser.getExtensionVersions();
		await this.governanceService.updateExtensionVersions(currentVersions);
	}

	/**
	 * Shows a notification about new shortcuts
	 */
	private async showNotification(notifications: NewShortcutsNotification[]): Promise<void> {
		const totalNew = notifications.reduce((sum, n) => sum + n.newCount, 0);

		let message: string;
		if (notifications.length === 1) {
			message = vscode.l10n.t(
				'{0} new shortcuts detected from {1}.',
				totalNew,
				notifications[0].extensionName
			);
		} else {
			message = vscode.l10n.t(
				'{0} new shortcuts detected from {1} extensions.',
				totalNew,
				notifications.length
			);
		}

		const review = vscode.l10n.t('Review');
		const ignore = vscode.l10n.t('Ignore');

		const result = await vscode.window.showInformationMessage(message, review, ignore);

		if (result === review) {
			await this.auditPanel.show();
		}
	}

	/**
	 * Performs initial check on activation
	 */
	async initialCheck(): Promise<void> {
		if (this.governanceService.isFirstRun()) {
			return;
		}

		await this.checkForNewShortcuts();
	}

	dispose(): void {
		this.disposable.dispose();
		this._onNewShortcuts.dispose();
	}
}
