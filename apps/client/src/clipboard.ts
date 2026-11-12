interface ClipboardEnvironment {
  clipboard?: Pick<Clipboard, "writeText">;
  document?: Document;
}

// navigator.clipboard is missing on plain-HTTP pages, so fall back to a hidden textarea and execCommand.
export async function copyText(text: string, environment: ClipboardEnvironment = { clipboard: navigator.clipboard, document }) {
  if (environment.clipboard) {
    await environment.clipboard.writeText(text);
    return;
  }
  const doc = environment.document;
  if (!doc) throw new Error("当前页面无法访问剪贴板");
  const field = doc.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  doc.body.appendChild(field);
  field.select();
  try {
    if (!doc.execCommand("copy")) throw new Error("浏览器拒绝了复制操作，请手动复制链接");
  } finally {
    field.remove();
  }
}
