import * as vscode from "vscode";

export class TabTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly tab?: vscode.Tab,
    public readonly groupIndex?: number
  ) {
    super(label, collapsibleState);
    this.contextValue = contextValue;

    if (contextValue === "tab" && tab) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText) {
        this.command = {
          command: "editorSpotlighter.focusTab",
          title: "Focus Tab",
          arguments: [input.uri],
        };
        this.resourceUri = input.uri;
        this.iconPath = vscode.ThemeIcon.File;
      }
    }
  }
}

export class TabTreeProvider implements vscode.TreeDataProvider<TabTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TabTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TabTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TabTreeItem): TabTreeItem[] {
    if (!element) {
      return this.getColumnHeaders();
    }

    if (element.contextValue === "column" && element.groupIndex !== undefined) {
      return this.getTabsForColumn(element.groupIndex);
    }

    return [];
  }

  private getColumnHeaders(): TabTreeItem[] {
    const items: TabTreeItem[] = [];
    const allGroups = vscode.window.tabGroups.all;

    for (let i = 0; i < allGroups.length; i++) {
      const group = allGroups[i];
      const tabCount = group.tabs.length;
      const label = `Column ${i + 1} (${tabCount} tabs)`;
      items.push(
        new TabTreeItem(
          label,
          vscode.TreeItemCollapsibleState.Expanded,
          "column",
          undefined,
          i
        )
      );
    }

    return items;
  }

  private getTabsForColumn(groupIndex: number): TabTreeItem[] {
    const items: TabTreeItem[] = [];
    const allGroups = vscode.window.tabGroups.all;

    if (groupIndex >= allGroups.length) {
      return items;
    }

    const group = allGroups[groupIndex];
    for (const tab of group.tabs) {
      const input = tab.input;
      let label: string;
      if (input instanceof vscode.TabInputText) {
        label = input.uri.path.split("/").pop() as string;
      } else {
        label = tab.label;
      }

      items.push(
        new TabTreeItem(
          label,
          vscode.TreeItemCollapsibleState.None,
          "tab",
          tab,
          groupIndex
        )
      );
    }

    return items;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
