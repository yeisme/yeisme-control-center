/** Files and directories (trailing "/") of the built app that the server sends and releases carry. */
export declare const servedEntries: readonly string[];
export declare function isServedPath(relative: string): boolean;
export declare function unservedPaths(relatives: readonly string[]): string[];
export declare function unservedTopLevel(names: readonly string[]): string[];
