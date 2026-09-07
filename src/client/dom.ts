export function element<K extends keyof HTMLElementTagNameMap>(
  name: K,
  properties: Partial<HTMLElementTagNameMap[K]> = {},
  container?: Node,
): HTMLElementTagNameMap[K] {
  const created = document.createElement(name);
  Object.assign(created, properties);
  container?.appendChild(created);
  return created;
}

export function insertAfter<T extends Node>(
  parent: Node,
  inserted: T,
  reference: Node,
): T {
  parent.insertBefore(inserted, reference.nextSibling);
  return inserted;
}

export interface Slider {
  label: HTMLLabelElement;
  input: HTMLInputElement;
  text: HTMLSpanElement;
  value(nextValue?: number): number;
}

export type SliderCallback = (
  slider: Slider,
  input: HTMLInputElement,
  value: number,
) => void;

export function slider(
  initialValue: number,
  minimum: number,
  maximum: number,
  step: number,
  container: Node,
  callback?: SliderCallback,
  reverse = false,
): Slider {
  const label = element("label");
  const text = element("span");
  const input = element("input");
  let currentValue = initialValue;

  const prepareValue = (value: number): number => reverse ? maximum + minimum - value : value;

  input.type = "range";
  input.max = String(maximum);
  input.min = String(minimum);
  input.step = String(step);
  label.append(text, element("br"), input);
  container.appendChild(label);

  const control: Slider = {
    label,
    input,
    text,
    value(nextValue) {
      if (nextValue !== undefined) {
        currentValue = nextValue;
        input.value = String(prepareValue(nextValue));
      }
      return currentValue;
    },
  };

  input.addEventListener("input", () => {
    const nextValue = prepareValue(input.valueAsNumber);
    if (currentValue !== nextValue) {
      callback?.(control, input, nextValue);
    }
    currentValue = nextValue;
  });

  callback?.(control, input, currentValue);
  control.value(initialValue);
  return control;
}

export function button(
  label: string,
  callback: () => void,
  container: Node,
  properties: Partial<HTMLButtonElement> = {},
): HTMLButtonElement {
  const created = element(
    "button",
    { ...properties, type: "button", textContent: label },
    container,
  );
  created.addEventListener("click", callback);
  return created;
}

export interface Timer {
  cancel(): void;
}

export function timer(
  initialDelay: number,
  onTick: (remaining: number) => void,
  onEnd: () => void,
  onCancel: () => void,
): Timer {
  let delay = initialDelay;
  let timeout: number | undefined;

  const tick = (): void => {
    if (delay > 0) {
      timeout = window.setTimeout(tick, 1_000);
      onTick(delay);
      delay -= 1;
    } else {
      onEnd();
    }
  };

  tick();
  return {
    cancel() {
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
      onCancel();
    },
  };
}
