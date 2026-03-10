export function bindDebouncedSearch(input, onCommit, delay = 180) {
  if (!input || typeof onCommit !== "function") {
    return () => {};
  }

  let timeoutId = null;

  const commit = (value) => {
    onCommit(value);

    window.requestAnimationFrame(() => {
      const refreshedInput = document.getElementById(input.id);

      if (!refreshedInput) {
        return;
      }

      refreshedInput.focus({ preventScroll: true });
      const cursor = String(value ?? "").length;
      refreshedInput.setSelectionRange(cursor, cursor);
    });
  };

  const handleInput = (event) => {
    const nextValue = event.target.value;

    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => commit(nextValue), delay);
  };

  input.addEventListener("input", handleInput);

  return () => {
    window.clearTimeout(timeoutId);
    input.removeEventListener("input", handleInput);
  };
}
