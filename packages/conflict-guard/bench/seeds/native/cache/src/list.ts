export interface Link<K> {
  key: K;
  previous?: Link<K>;
  next?: Link<K>;
}
export class RecencyList<K> {
  head?: Link<K>;
  tail?: Link<K>;
  length = 0;
  prepend(key: K) {
    const link: Link<K> = { key, next: this.head };
    if (this.head) this.head.previous = link;
    else this.tail = link;
    this.head = link;
    this.length += 1;
    return link;
  }
  remove(link: Link<K>) {
    if (link.previous) link.previous.next = link.next;
    else this.head = link.next;
    if (link.next) link.next.previous = link.previous;
    else this.tail = link.previous;
    link.next = undefined;
    link.previous = undefined;
    this.length -= 1;
  }
  promote(link: Link<K>) {
    if (link === this.head) return;
    this.remove(link);
    link.next = this.head;
    if (this.head) this.head.previous = link;
    else this.tail = link;
    this.head = link;
    this.length += 1;
  }
  *keys() {
    let cursor = this.head;
    while (cursor) {
      yield cursor.key;
      cursor = cursor.next;
    }
  }
  verify() {
    let count = 0;
    let previous: Link<K> | undefined;
    for (let cursor = this.head; cursor; cursor = cursor.next) {
      if (cursor.previous !== previous) throw new Error('broken previous link');
      previous = cursor;
      count += 1;
    }
    if (previous !== this.tail || count !== this.length) throw new Error('broken list boundary');
    return true;
  }
}
