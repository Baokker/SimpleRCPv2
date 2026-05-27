import Editor from "@monaco-editor/react";

export interface OpenFile {
  path: string;
  content: string;
}

export function EditorArea({
  openFiles,
  activePath,
  onSelectFile,
  onChangeFile
}: {
  openFiles: OpenFile[];
  activePath?: string;
  onSelectFile(path: string): void;
  onChangeFile(path: string, content: string): void;
}) {
  const activeFile = openFiles.find((file) => file.path === activePath);

  return (
    <div className="editor-area">
      <div className="tabs" data-testid="editor-tabs">
        {openFiles.map((file) => (
          <button
            key={file.path}
            className={file.path === activePath ? "tab active" : "tab"}
            onClick={() => onSelectFile(file.path)}
          >
            {file.path}
          </button>
        ))}
      </div>
      <div className="editor-frame" data-testid="editor-frame">
        {activeFile ? (
          <Editor
            path={activeFile.path}
            value={activeFile.content}
            language={languageForPath(activeFile.path)}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              wordWrap: "on",
              scrollBeyondLastLine: false
            }}
            onChange={(value) => onChangeFile(activeFile.path, value ?? "")}
          />
        ) : (
          <div className="empty-state">Open a file to start collaborating.</div>
        )}
      </div>
    </div>
  );
}

function languageForPath(path: string) {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  return "plaintext";
}
