import { GovernanceStatus } from './keybinding';

/**
 * A snapshot of keybindings.json content
 */
export interface Snapshot {
	/** Unique identifier */
	id: string;
	/** User-provided name or auto-generated */
	name: string;
	/** When the snapshot was created */
	createdAt: number;
	/** Raw content of keybindings.json */
	keybindingsContent: string;
	/** Governance state at snapshot time */
	governanceState: GovernanceState;
}

/**
 * Governance state stored in globalState
 */
export interface GovernanceState {
	/** Version for migration purposes */
	version: number;
	/** Map of keybinding ID to its governance status */
	decisions: Record<string, GovernanceDecision>;
	/** Map of extension ID to its version when last audited */
	extensionVersions: Record<string, string>;
	/** Whether the initial audit has been completed */
	initialAuditComplete: boolean;
	/** Timestamp of last state update */
	lastUpdated: number;
}

/**
 * A single governance decision
 */
export interface GovernanceDecision {
	/** The keybinding ID this decision applies to */
	keybindingId: string;
	/** The governance status */
	status: GovernanceStatus;
	/** Original key if remapped */
	originalKey?: string;
	/** New key if remapped */
	remappedKey?: string;
	/** When the decision was made */
	decidedAt: number;
	/** Extension ID this keybinding belongs to */
	extensionId?: string;
}

/**
 * Creates an empty governance state
 */
export function createEmptyGovernanceState(): GovernanceState {
	return {
		version: 1,
		decisions: {},
		extensionVersions: {},
		initialAuditComplete: false,
		lastUpdated: Date.now(),
	};
}

/**
 * Generates a unique snapshot ID
 */
export function generateSnapshotId(): string {
	return `snapshot-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}
