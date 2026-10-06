export default async function* report(events) {
  for await (const event of events) {
    if (event.type === "test:summary") yield JSON.stringify(event.data) + "\n";
  }
}
