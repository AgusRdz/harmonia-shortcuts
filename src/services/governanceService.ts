import * as vscode from 'vscode';
import {
	Keybinding,
	GovernedKeybinding,
	GovernanceStatus,
	GovernanceState,
	GovernanceDecision,
	createEmptyGovernanceState,
} from '../types';
import { KeybindingsFileService } from './keybindingsFileService';
import { KeybindingParser } from './keybindingParser';

const GOVERNANCE_STATE_KEY = 'harmonia-shortcuts.governanceState';

/**
 * Service for managing keybinding governance state
 */
export class GovernanceService {
	private state: GovernanceState;
	private readonly _onStateChanged = new vscode.EventEmitter<GovernanceState>();
	readonly onStateChanged = this._onStateChanged.event;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly fileService: KeybindingsFileService,
		private readonly parser: KeybindingParser
	) {
		this.state = this.loadState();
	}

	/**
	 * Loads governance state from global state
	 */
	private loadState(): GovernanceState {
		return this.context.globalState.get<GovernanceState>(
			GOVERNANCE_STATE_KEY,
			createEmptyGovernanceState()
		);
	}

	/**
	 * Saves governance state to global state
	 */
	private async saveState(): Promise<void> {
		this.state.lastUpdated = Date.now();
		await this.context.globalState.update(GOVERNANCE_STATE_KEY, this.state);
		this._onStateChanged.fire(this.state);
	}

	/**
	 * Gets the current governance state
	 */
	getState(): GovernanceState {
		return { ...this.state };
	}

	/**
	 * Sets the entire governance state (used for snapshot restore)
	 */
	async setState(state: GovernanceState): Promise<void> {
		this.state = { ...state };
		await this.saveState();
	}

	/**
	 * Checks if this is the first run
	 */
	isFirstRun(): boolean {
		return !this.state.initialAuditComplete;
	}

	/**
	 * Marks the initial audit as complete
	 */
	async markInitialAuditComplete(): Promise<void> {
		this.state.initialAuditComplete = true;
		await this.saveState();
	}

	/**
	 * Gets the governance decision for a keybinding
	 */
	getDecision(keybindingId: string): GovernanceDecision | undefined {
		return this.state.decisions[keybindingId];
	}

	/**
	 * Gets the status for a keybinding
	 */
	getStatus(keybindingId: string): GovernanceStatus {
		return this.state.decisions[keybindingId]?.status ?? 'pending';
	}

	/**
	 * Records a governance decision
	 */
	async recordDecision(
		keybinding: Keybinding,
		status: GovernanceStatus,
		remappedKey?: string
	): Promise<void> {
		const decision: GovernanceDecision = {
			keybindingId: keybinding.id,
			status,
			decidedAt: Date.now(),
			extensionId: keybinding.extensionId,
		};

		if (status === 'remapped' && remappedKey) {
			decision.originalKey = keybinding.key;
			decision.remappedKey = remappedKey;
		}

		this.state.decisions[keybinding.id] = decision;
		await this.saveState();
	}

	/**
	 * Applies a decision by modifying keybindings.json
	 */
	async applyDecision(
		keybinding: Keybinding,
		action: 'deactivate' | 'remap',
		newKey?: string
	): Promise<void> {
		if (action === 'deactivate') {
			await this.fileService.deactivateKeybinding(
				keybinding.key,
				keybinding.command,
				keybinding.when
			);
			await this.recordDecision(keybinding, 'deactivated');
		} else if (action === 'remap' && newKey) {
			await this.fileService.remapKeybinding(
				keybinding.key,
				newKey,
				keybinding.command,
				keybinding.when
			);
			await this.recordDecision(keybinding, 'remapped', newKey);
		}
	}

	/**
	 * Approves a keybinding (keeps it active)
	 */
	async approveKeybinding(keybinding: Keybinding): Promise<void> {
		await this.recordDecision(keybinding, 'approved');
	}

	/**
	 * Unapproves a keybinding (sends it back to unreviewed)
	 */
	async unapproveKeybinding(keybinding: Keybinding): Promise<void> {
		delete this.state.decisions[keybinding.id];
		await this.saveState();
	}

	/**
	 * Batch unapprove all approved keybindings from an extension
	 */
	async unapproveAllFromExtension(extensionId: string): Promise<number> {
		const keybindings = this.parser.getKeybindingsForExtension(extensionId);
		let count = 0;

		for (const kb of keybindings) {
			if (this.getStatus(kb.id) === 'approved') {
				await this.unapproveKeybinding(kb);
				count++;
			}
		}

		return count;
	}

	/**
	 * Skips a keybinding (decide later)
	 */
	async skipKeybinding(keybinding: Keybinding): Promise<void> {
		await this.recordDecision(keybinding, 'skipped');
	}

	/**
	 * Gets keybindings with governance state attached
	 */
	getGovernedKeybindings(keybindings: Keybinding[]): GovernedKeybinding[] {
		return keybindings.map(kb => {
			const decision = this.state.decisions[kb.id];
			return {
				...kb,
				status: decision?.status ?? 'pending',
				originalKey: decision?.originalKey,
				remappedKey: decision?.remappedKey,
				decidedAt: decision?.decidedAt,
			};
		});
	}

	/**
	 * Gets pending keybindings that need decisions
	 */
	getPendingKeybindings(keybindings: Keybinding[]): Keybinding[] {
		return keybindings.filter(kb => {
			const status = this.getStatus(kb.id);
			return status === 'pending';
		});
	}

	/**
	 * Updates stored extension versions
	 */
	async updateExtensionVersions(versions: Record<string, string>): Promise<void> {
		this.state.extensionVersions = { ...versions };
		await this.saveState();
	}

	/**
	 * Gets extensions that have new or updated keybindings
	 */
	getNewOrUpdatedExtensions(): { extensionId: string; isNew: boolean }[] {
		const currentVersions = this.parser.getExtensionVersions();
		const result: { extensionId: string; isNew: boolean }[] = [];

		for (const [extensionId, version] of Object.entries(currentVersions)) {
			const storedVersion = this.state.extensionVersions[extensionId];

			if (!storedVersion) {
				result.push({ extensionId, isNew: true });
			} else if (storedVersion !== version) {
				result.push({ extensionId, isNew: false });
			}
		}

		return result;
	}

	/**
	 * Gets new keybindings from updated extensions
	 */
	getNewKeybindings(): Keybinding[] {
		const allExtensionBindings = this.parser.getAllExtensionKeybindings();
		return allExtensionBindings.filter(kb => {
			const status = this.getStatus(kb.id);
			return status === 'pending';
		});
	}

	/**
	 * Batch approve all keybindings from an extension
	 */
	async approveAllFromExtension(extensionId: string): Promise<number> {
		const keybindings = this.parser.getKeybindingsForExtension(extensionId);
		let count = 0;

		for (const kb of keybindings) {
			if (this.getStatus(kb.id) === 'pending') {
				await this.approveKeybinding(kb);
				count++;
			}
		}

		return count;
	}

	/**
	 * Batch deactivate all keybindings from an extension
	 */
	async deactivateAllFromExtension(extensionId: string): Promise<number> {
		const keybindings = this.parser.getKeybindingsForExtension(extensionId);
		let count = 0;

		for (const kb of keybindings) {
			if (this.getStatus(kb.id) === 'pending') {
				await this.applyDecision(kb, 'deactivate');
				count++;
			}
		}

		return count;
	}

	/**
	 * Restores a deactivated keybinding (removes negation from keybindings.json)
	 */
	async restoreKeybinding(keybinding: Keybinding): Promise<void> {
		await this.fileService.restoreKeybinding(
			keybinding.key,
			keybinding.command,
			keybinding.when
		);
		await this.recordDecision(keybinding, 'pending');
	}

	/**
	 * Restores a remapped keybinding (removes remap entries from keybindings.json)
	 */
	async restoreRemappedKeybinding(keybinding: Keybinding): Promise<void> {
		await this.fileService.removeRemapEntries(keybinding.command);
		await this.recordDecision(keybinding, 'pending');
	}

	/**
	 * Batch restore all deactivated keybindings from an extension
	 */
	async restoreAllFromExtension(extensionId: string): Promise<number> {
		const keybindings = this.parser.getKeybindingsForExtension(extensionId);
		let count = 0;

		for (const kb of keybindings) {
			if (this.getStatus(kb.id) === 'deactivated') {
				await this.restoreKeybinding(kb);
				count++;
			}
		}

		return count;
	}

	/**
	 * Resets all governance decisions
	 */
	async resetAllDecisions(): Promise<void> {
		this.state = createEmptyGovernanceState();
		await this.saveState();
	}

	/**
	 * Cleans up all governance entries from keybindings.json
	 * Used when preparing for extension uninstall
	 */
	async cleanupKeybindingsFile(): Promise<number> {
		const allExtBindings = this.parser.getAllExtensionKeybindings();
		let cleanedCount = 0;

		for (const kb of allExtBindings) {
			const decision = this.state.decisions[kb.id];
			if (decision?.status === 'deactivated') {
				// Remove negation entry
				await this.fileService.restoreKeybinding(kb.key, kb.command, kb.when);
				cleanedCount++;
			} else if (decision?.status === 'remapped') {
				// Remove remap entries
				await this.fileService.removeRemapEntries(kb.command);
				cleanedCount++;
			}
		}

		return cleanedCount;
	}

	/**
	 * Full cleanup for uninstall - reverts keybindings.json and clears state
	 */
	async prepareForUninstall(): Promise<number> {
		const cleanedCount = await this.cleanupKeybindingsFile();
		await this.resetAllDecisions();
		return cleanedCount;
	}

	/**
	 * Gets statistics about governance state
	 */
	getStatistics(): {
		total: number;
		pending: number;
		approved: number;
		deactivated: number;
		remapped: number;
		skipped: number;
	} {
		const decisions = Object.values(this.state.decisions);
		return {
			total: decisions.length,
			pending: 0,
			approved: decisions.filter(d => d.status === 'approved').length,
			deactivated: decisions.filter(d => d.status === 'deactivated').length,
			remapped: decisions.filter(d => d.status === 'remapped').length,
			skipped: decisions.filter(d => d.status === 'skipped').length,
		};
	}
}
