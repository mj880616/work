// ED-통합편집기 ①a: the one ProseMirror bundle the editor imports (scripts/editor/vendor-editor.mjs builds it).
// Only what app/ed-editor.js and app/ed-schema.mjs use is exported; one copy of each package (they must not be loaded twice).
// ED-기본기보강 (pm-ed1-1.1.0): + gapcursor (a cursor before/after a table or photo at the start or end of the text), and the
// table helpers that were left out: column width dragging, cell selection, merge/split, add before.
export {Schema, Fragment, Slice, DOMParser, DOMSerializer, Node} from 'prosemirror-model';
export {EditorState, Plugin, PluginKey, Selection, TextSelection, NodeSelection, AllSelection} from 'prosemirror-state';
export {EditorView} from 'prosemirror-view';
export {keymap} from 'prosemirror-keymap';
export {history, undo, redo, undoDepth, redoDepth, closeHistory} from 'prosemirror-history';
export {baseKeymap, toggleMark, setBlockType, wrapIn, lift, chainCommands, exitCode, splitBlockAs, newlineInCode,
  createParagraphNear, liftEmptyBlock, selectAll} from 'prosemirror-commands';
export {wrapInList, splitListItem, liftListItem, sinkListItem} from 'prosemirror-schema-list';
export {gapCursor, GapCursor} from 'prosemirror-gapcursor';
export {tableEditing, columnResizing, columnResizingPluginKey, goToNextCell, addRowAfter, addRowBefore, deleteRow,
  addColumnAfter, addColumnBefore, deleteColumn, deleteTable, toggleHeaderRow, isInTable, fixTables, tableNodes,
  CellSelection, TableMap, mergeCells, splitCell, selectedRect, findTable, cellAround} from 'prosemirror-tables';
