async (page) => {
  const [alice, bob] = page.context().browser().contexts().flatMap(context => context.pages());
  const root = globalThis.CAPTURE_OUTPUT;
  for (const member of [alice, bob]) {
    const separator = member.getByRole("separator", { name: "Resize collaboration panel" });
    const box = await separator.boundingBox();
    await member.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await member.mouse.down();
    // The original demo dragged to x=880 in a 1440 px window; keep the panel at the capture width instead.
    await member.mouse.move(member.viewportSize().width - Number(globalThis.CAPTURE_PANEL_WIDTH ?? 560), box.y + box.height / 2, { steps: 12 });
    await member.mouse.up();
  }
  await alice.screenshot({ path: root + "09-agent-start-alice.png" });
  await bob.screenshot({ path: root + "09-agent-start-bob.png" });
  return Promise.all([alice, bob].map(member => member.getByTestId("status-bar").innerText()));
}
