export class InputButtons {
  private down = new Set<string>();
  private firePending = false;

  add(key: string) {
    if (key === 'fire' && !this.down.has(key)) this.firePending = true;
    this.down.add(key);
    return this;
  }

  has(key: string) { return this.down.has(key); }
  delete(key: string) { return this.down.delete(key); }
  clear() { this.down.clear(); this.firePending = false; }

  consumeFire() {
    const fire = this.firePending || this.down.has('fire');
    this.firePending = false;
    return fire;
  }
}