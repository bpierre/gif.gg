import { element } from "./dom";

export interface ProgressIndicator {
  hide(): void;
  show(message?: string): void;
  value(nextValue?: number | false): number | undefined;
}

export function createProgress(
  maximum: number,
  container: Node,
): ProgressIndicator {
  const wrapper = element("div", { className: "progress", hidden: true });
  const progress = element("progress");
  const label = element("label");
  progress.max = maximum;
  wrapper.append(label, progress);
  container.appendChild(wrapper);

  return {
    hide() {
      wrapper.hidden = true;
    },
    show(message) {
      if (message) {
        label.textContent = message;
      }
      wrapper.hidden = false;
    },
    value(nextValue) {
      if (nextValue === undefined) {
        return progress.value;
      }
      if (nextValue === false) {
        progress.removeAttribute("value");
        return undefined;
      }

      progress.value = nextValue;
      progress.textContent = `${nextValue} / ${maximum}`;
      return nextValue;
    },
  };
}
