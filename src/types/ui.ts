import { GovernedKeybinding, KeybindingConflict } from './keybinding';

/**
 * Categories shown in the audit tree view
 */
export type AuditCategory = 'user' | 'extension' | 'conflict' | 'default';

/**
 * Actions available for keybindings in the audit view
 */
export type DecisionAction = 'keepActive' | 'deactivate' | 'remap' | 'skip';

/**
 * Tree item types for context value
 */
export type TreeItemType =
	| 'category'
	| 'extensionGroup'
	| 'userKeybinding'
	| 'extensionKeybinding'
	| 'conflictItem'
	| 'defaultKeybinding';

/**
 * State of the audit view
 */
export interface AuditViewState {
	/** Whether to show VS Code defaults */
	showDefaults: boolean;
	/** Whether to group by extension */
	groupByExtension: boolean;
	/** Currently expanded categories */
	expandedCategories: Set<AuditCategory>;
	/** Currently expanded extension groups */
	expandedExtensions: Set<string>;
	/** Filter text */
	filterText?: string;
}

/**
 * Data passed to tree items
 */
export interface TreeItemData {
	type: TreeItemType;
	category?: AuditCategory;
	extensionId?: string;
	extensionName?: string;
	keybinding?: GovernedKeybinding;
	conflict?: KeybindingConflict;
	count?: number;
}

/**
 * Quick pick item for decision actions
 */
export interface DecisionQuickPickItem {
	label: string;
	description?: string;
	detail?: string;
	action: DecisionAction;
}

/**
 * Quick pick item for extension batch operations
 */
export interface ExtensionBatchQuickPickItem {
	label: string;
	description?: string;
	extensionId: string;
	action: 'approveAll' | 'deactivateAll';
}

/**
 * Result of a remap operation
 */
export interface RemapResult {
	success: boolean;
	newKey?: string;
	error?: string;
}

/**
 * Notification about new shortcuts
 */
export interface NewShortcutsNotification {
	extensionId: string;
	extensionName: string;
	newCount: number;
	keybindingIds: string[];
}
