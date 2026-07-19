// LinkedIn and Indeed both build their apply forms with React. React wraps
// the native value setter on <input>/<textarea>/<select> so its own
// onChange only fires from the synthetic event system -- setting
// `el.value = x` directly is silently ignored by the framework. Calling the
// *native* setter (bypassing React's instance-level override) and then
// dispatching a real "input" event is the standard workaround.
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = Object.getPrototypeOf(el);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function fillTextInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): boolean {
  if (!value) return false;
  setNativeValue(el, value);
  return true;
}

// Case-insensitive substring match against option text/value -- "Yes" needs
// to match an <option> whose visible text is "Yes" even if the underlying
// value attribute is "true" or "1".
export function fillSelect(el: HTMLSelectElement, value: string): boolean {
  const target = value.trim().toLowerCase();
  const option = Array.from(el.options).find(
    (opt) =>
      opt.value.trim().toLowerCase() === target ||
      opt.textContent?.trim().toLowerCase() === target,
  );
  if (!option) return false;

  el.value = option.value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export function fillRadioGroup(radios: HTMLInputElement[], value: string): boolean {
  const target = value.trim().toLowerCase();
  const match = radios.find((r) => {
    const label = labelTextFor(r).trim().toLowerCase();
    return label === target || r.value.trim().toLowerCase() === target;
  });
  if (!match) return false;

  match.click();
  return true;
}

export function fillCheckbox(el: HTMLInputElement, value: string): boolean {
  const truthy = ["yes", "true", "1", "on", "checked"].includes(value.trim().toLowerCase());
  if (el.checked !== truthy) el.click();
  return true;
}

export async function fillFileInput(
  input: HTMLInputElement,
  fileUrl: string,
  filename: string,
): Promise<boolean> {
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) return false;
    const blob = await res.blob();
    const file = new File([blob], filename, { type: blob.type });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

// Resolves the visible label text for a form control: <label for="id">,
// an ancestor <label>, or aria-label -- covers how both LinkedIn and Indeed
// mark up their fields.
export function labelTextFor(el: HTMLElement): string {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  const ariaLabelledBy = el.getAttribute("aria-labelledby");
  if (ariaLabelledBy) {
    const text = ariaLabelledBy
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text) return text;
  }

  if (el.id) {
    const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (forLabel?.textContent) return forLabel.textContent.trim();
  }

  const ancestorLabel = el.closest("label");
  if (ancestorLabel?.textContent) return ancestorLabel.textContent.trim();

  return "";
}
