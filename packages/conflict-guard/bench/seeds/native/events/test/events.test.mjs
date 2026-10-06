import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventBus } from '../src/bus.ts';
import { EventStream } from '../src/stream.ts';
import { TopicRouter, payloadHas } from '../src/routes.ts';
import { DeliveryLedger } from '../src/delivery.ts';

describe('delivery pipeline', () => {
  it('routes nested publication in sequence and acknowledges subscribers', () => {
    const bus = new EventBus();
    const stream = new EventStream(10);
    const router = new TopicRouter();
    const delivery = new DeliveryLedger(3);
    router.register('audit', ['created'], payloadHas('id'));
    bus.subscribe('*', (event) => {
      stream.append(event);
      delivery.enqueue(event, router.route(event));
    });
    bus.once('created', () => bus.publish('followup', {}));
    bus.publish('created', { id: 5 });
    assert.deepEqual(stream.read('audit', 10).map((event) => event.topic), ['created', 'followup']);
    assert.equal(delivery.pending('audit').length, 1);
    delivery.failure(1, 'audit', 0, 'network');
    assert.equal(delivery.ready(1000).length, 1);
    delivery.success(1, 'audit');
    assert.equal(delivery.pending().length, 0);
    stream.commit('audit', 2);
    assert.equal(stream.lag('audit'), 0);
  });
  it('isolates subscriber failures and permits removal during publish', () => {
    const bus = new EventBus();
    let called = 0;
    bus.subscribe('x', () => { throw new Error('handler'); });
    bus.once('x', () => called++);
    bus.publish('x', 1);
    bus.publish('x', 2);
    assert.equal(called, 1);
    assert.equal(bus.errors.length, 2);
  });
});
