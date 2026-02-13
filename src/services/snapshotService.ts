import * as vscode from 'vscode';
import { Snapshot, GovernanceState, generateSnapshotId } from '../types';
import { KeybindingsFileService } from './keybindingsFileService';

const SNAPSHOTS_KEY = 'harmonia-shortcuts.snapshots';
const MAX_SNAPSHOTS = 10;

/**
 * Service for creating and restoring keybindings snapshots
 */
export class SnapshotService {
	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly fileService: KeybindingsFileService
	) {}

	/**
	 * Creates a new snapshot of current keybindings and governance state
	 */
	async createSnapshot(
		name: string,
		governanceState: GovernanceState
	): Promise<Snapshot> {
		const keybindingsContent = await this.fileService.readRaw();

		const snapshot: Snapshot = {
			id: generateSnapshotId(),
			name,
			createdAt: Date.now(),
			keybindingsContent,
			governanceState: { ...governanceState },
		};

		await this.saveSnapshot(snapshot);
		return snapshot;
	}

	/**
	 * Creates the initial base snapshot on first run
	 */
	async createBaseSnapshot(governanceState: GovernanceState): Promise<Snapshot> {
		const existingSnapshots = await this.getSnapshots();
		const baseSnapshot = existingSnapshots.find(s => s.name === 'Base Snapshot');

		if (baseSnapshot) {
			return baseSnapshot;
		}

		return this.createSnapshot('Base Snapshot', governanceState);
	}

	/**
	 * Restores keybindings from a snapshot
	 */
	async restoreSnapshot(snapshotId: string): Promise<GovernanceState | undefined> {
		const snapshots = await this.getSnapshots();
		const snapshot = snapshots.find(s => s.id === snapshotId);

		if (!snapshot) {
			return undefined;
		}

		const parsed = JSON.parse(snapshot.keybindingsContent);
		await this.fileService.write(Array.isArray(parsed) ? parsed : []);

		return snapshot.governanceState;
	}

	/**
	 * Gets all saved snapshots
	 */
	async getSnapshots(): Promise<Snapshot[]> {
		const snapshots = this.context.globalState.get<Snapshot[]>(SNAPSHOTS_KEY, []);
		return snapshots.sort((a, b) => b.createdAt - a.createdAt);
	}

	/**
	 * Saves a snapshot, enforcing max limit
	 */
	private async saveSnapshot(snapshot: Snapshot): Promise<void> {
		let snapshots = await this.getSnapshots();

		const baseIndex = snapshots.findIndex(s => s.name === 'Base Snapshot');
		const baseSnapshot = baseIndex !== -1 ? snapshots.splice(baseIndex, 1)[0] : null;

		snapshots.unshift(snapshot);

		if (snapshots.length > MAX_SNAPSHOTS - (baseSnapshot ? 1 : 0)) {
			snapshots = snapshots.slice(0, MAX_SNAPSHOTS - (baseSnapshot ? 1 : 0));
		}

		if (baseSnapshot) {
			snapshots.push(baseSnapshot);
		}

		await this.context.globalState.update(SNAPSHOTS_KEY, snapshots);
	}

	/**
	 * Deletes a snapshot
	 */
	async deleteSnapshot(snapshotId: string): Promise<boolean> {
		const snapshots = await this.getSnapshots();
		const index = snapshots.findIndex(s => s.id === snapshotId);

		if (index === -1) {
			return false;
		}

		snapshots.splice(index, 1);
		await this.context.globalState.update(SNAPSHOTS_KEY, snapshots);
		return true;
	}

	/**
	 * Gets a snapshot by ID
	 */
	async getSnapshot(snapshotId: string): Promise<Snapshot | undefined> {
		const snapshots = await this.getSnapshots();
		return snapshots.find(s => s.id === snapshotId);
	}

	/**
	 * Renames a snapshot
	 */
	async renameSnapshot(snapshotId: string, newName: string): Promise<boolean> {
		const snapshots = await this.getSnapshots();
		const snapshot = snapshots.find(s => s.id === snapshotId);

		if (!snapshot) {
			return false;
		}

		snapshot.name = newName;
		await this.context.globalState.update(SNAPSHOTS_KEY, snapshots);
		return true;
	}
}
