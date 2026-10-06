import type { Envelope } from './bus.ts';

export type RoutePredicate = (event: Envelope) => boolean;
interface Route {
  subscriber: string;
  topics: Set<string>;
  accept: RoutePredicate;
  priority: number;
}

export class TopicRouter {
  private rules: Route[] = [];
  register(subscriber: string, topics: string[], accept: RoutePredicate, priority = 0) {
    if (!subscriber || !topics.length) throw new Error('route identity');
    this.rules.push({ subscriber, topics: new Set(topics), accept, priority });
    this.rules.sort((a, b) => b.priority - a.priority);
  }
  route(event: Envelope) {
    const recipients = new Set<string>();
    for (const rule of this.rules) {
      if (rule.topics.has(event.topic) && rule.accept(event)) recipients.add(rule.subscriber);
    }
    return [...recipients];
  }
  remove(subscriber: string) {
    const count = this.rules.length;
    this.rules = this.rules.filter((rule) => rule.subscriber !== subscriber);
    return count - this.rules.length;
  }
  topics() {
    return [...new Set(this.rules.flatMap((rule) => [...rule.topics]))].sort();
  }
  count(subscriber: string) {
    return this.rules.filter((rule) => rule.subscriber === subscriber).length;
  }
}

export function payloadHas(field: string): RoutePredicate {
  return (event) => typeof event.payload === 'object' && event.payload !== null && Object.hasOwn(event.payload, field);
}
export function correlated(value: string): RoutePredicate {
  return (event) => event.correlation === value;
}
export function every(...conditions: RoutePredicate[]): RoutePredicate {
  return (event) => conditions.every((condition) => condition(event));
}
export function any(...conditions: RoutePredicate[]): RoutePredicate {
  return (event) => conditions.some((condition) => condition(event));
}
export function negate(condition: RoutePredicate): RoutePredicate {
  return (event) => !condition(event);
}
