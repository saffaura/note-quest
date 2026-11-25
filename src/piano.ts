import { isBlackKey } from './theory';

export type KeyFlash = 'good' | 'okay' | 'bad' | 'hint';

/** On-screen piano. Pointer events give us mouse, touch and multi-touch with one code path. */
export class Piano {
  private keys = new Map<number, HTMLElement>();
  private pointerKeys = new Map<number, number>();
  private flashTimers = new Map<number, number>();
  onPress: (midi: number) => void = () => {};

  constructor(private root: HTMLElement) {
    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointerup', (e) => this.up(e));
    root.addEventListener('pointercancel', (e) => this.up(e));
    root.addEventListener('pointerleave', (e) => this.up(e));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  build(lo: number, hi: number): void {
    this.root.replaceChildren();
    this.keys.clear();
    const whites: number[] = [];
    for (let m = lo; m <= hi; m++) if (!isBlackKey(m)) whites.push(m);
    const whiteWidth = 100 / whites.length;

    whites.forEach((midi, i) => {
      const el = this.makeKey(midi, 'white');
      el.style.left = `${i * whiteWidth}%`;
      el.style.width = `${whiteWidth}%`;
      this.root.appendChild(el);
    });
    for (let m = lo; m <= hi; m++) {
      if (!isBlackKey(m)) continue;
      const leftWhite = whites.indexOf(m - 1);
      if (leftWhite < 0) continue;
      const el = this.makeKey(m, 'black');
      el.style.left = `${(leftWhite + 1) * whiteWidth - whiteWidth * 0.3}%`;
      el.style.width = `${whiteWidth * 0.6}%`;
      this.root.appendChild(el);
    }
  }

  flash(midi: number, kind: KeyFlash): void {
    const el = this.keys.get(midi);
    if (!el) return;
    window.clearTimeout(this.flashTimers.get(midi));
    el.classList.remove('good', 'okay', 'bad', 'hint');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(kind);
    this.flashTimers.set(
      midi,
      window.setTimeout(() => el.classList.remove(kind), kind === 'hint' ? 1300 : 450),
    );
  }

  private makeKey(midi: number, color: 'white' | 'black'): HTMLElement {
    const el = document.createElement('div');
    el.className = `key ${color}`;
    el.dataset.midi = String(midi);
    this.keys.set(midi, el);
    return el;
  }

  private keyAt(e: PointerEvent): number | null {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const keyEl = target?.closest<HTMLElement>('.key');
    return keyEl ? Number(keyEl.dataset.midi) : null;
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    const midi = this.keyAt(e);
    if (midi === null) return;
    this.pointerKeys.set(e.pointerId, midi);
    this.keys.get(midi)?.classList.add('down');
    this.onPress(midi);
  }

  private up(e: PointerEvent): void {
    const midi = this.pointerKeys.get(e.pointerId);
    if (midi === undefined) return;
    this.pointerKeys.delete(e.pointerId);
    this.keys.get(midi)?.classList.remove('down');
  }
}
