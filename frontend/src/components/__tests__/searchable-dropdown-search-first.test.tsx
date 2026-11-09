// @ts-nocheck
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost:3000/admin/submission-failures' });
const globalAny = globalThis as any;
globalAny.window = win;
globalAny.document = win.document;
try { globalAny.navigator = win.navigator; } catch {}
globalAny.HTMLElement = win.HTMLElement;
globalAny.HTMLInputElement = win.HTMLInputElement;
globalAny.Event = win.Event;
globalAny.CustomEvent = win.CustomEvent;
globalAny.KeyboardEvent = win.KeyboardEvent;
globalAny.MouseEvent = win.MouseEvent;
globalAny.localStorage = win.localStorage;
globalAny.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 0);
globalAny.cancelAnimationFrame = clearTimeout;
globalAny.IS_REACT_ACT_ENVIRONMENT = true;

let React: any;
let createRoot: any;
let act: any;
let SearchableDropdown: any;

async function bootstrap() {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  act = React.act;
  const mod = await import('../SearchableDropdown');
  SearchableDropdown = mod.SearchableDropdown;
}

function setNativeValue(el: any, value: string) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, value);
  else el.value = value;
}

async function typeInto(el: any, value: string) {
  await act(async () => {
    setNativeValue(el, value);
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  });
}

const mockRounds = [
  { id: '', label: 'ทุกรอบรับสมัคร' },
  { id: 'r1', label: '[ADM-2026-01] รับสมัครพนักงานพัฒนาซอฟต์แวร์', code: 'ADM-2026-01', subLabel: 'รับสมัครพนักงานพัฒนาซอฟต์แวร์' },
  { id: 'r2', label: '[ADM-2026-02] รับสมัครนักวิชาการคอมพิวเตอร์', code: 'ADM-2026-02', subLabel: 'รับสมัครนักวิชาการคอมพิวเตอร์' },
  { id: 'r3', label: '[GEN-2026-01] บุคลากรสายสนับสนุนทั่วไป', code: 'GEN-2026-01', subLabel: 'บุคลากรสายสนับสนุนทั่วไป' },
];

function TestWrapper({ searchFirst = true, initialValue = '' }: { searchFirst?: boolean; initialValue?: string }) {
  const [value, setValue] = React.useState<string | null>(initialValue);
  return (
    <div id="wrapper">
      <SearchableDropdown
        searchFirst={searchFirst}
        options={mockRounds}
        value={value}
        onChange={(val: any) => setValue(val || '')}
        placeholder="ค้นหารอบรับสมัคร..."
        emptyText="ไม่พบรอบรับสมัคร"
      />
      <div id="current-value">{value || 'empty'}</div>
      <button id="external-clear" onClick={() => setValue('')}>ล้าง</button>
    </div>
  );
}

async function waitTick() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

async function runTests() {
  await bootstrap();
  const assert = (await import('node:assert/strict')).default;

  console.log('=================================================');
  console.log('SearchableDropdown searchFirst UI UX Tests');
  console.log('=================================================');

  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container);

  // Test 1: Search-first mode renders an input directly with placeholder [🔍 ค้นหารอบรับสมัคร...]
  await act(async () => {
    root.render(React.createElement(TestWrapper, { searchFirst: true, initialValue: '' }));
  });
  await waitTick();

  const searchInput = container.querySelector('input[type="text"]') as HTMLInputElement;
  assert.ok(searchInput, 'Must render input[type="text"] directly');
  assert.equal(searchInput.placeholder, 'ค้นหารอบรับสมัคร...', 'Placeholder should match requirement');
  const triggerBtn = container.querySelector('button.flex.h-10');
  assert.equal(triggerBtn, null, 'Must NOT render select-like button in searchFirst mode');
  console.log('✓ Test 1: Renders search input pattern directly [🔍 ค้นหารอบรับสมัคร...] (not dropdown button)');

  // Test 2: Focus opens suggestions showing all rounds + "ทุกรอบรับสมัคร"
  await act(async () => {
    searchInput.focus();
    searchInput.dispatchEvent(new win.Event('focus'));
  });
  await waitTick();

  let optionsList = container.querySelectorAll('li[role="option"]');
  assert.equal(optionsList.length, 4, 'Should show all 4 options when query is empty');
  assert.ok(optionsList[0].textContent.includes('ทุกรอบรับสมัคร'));
  console.log('✓ Test 2: Focusing search input opens matching rounds suggestions');

  // Test 3: Typing roundCode filters matching rounds
  await typeInto(searchInput, 'ADM-2026');
  await waitTick();

  optionsList = container.querySelectorAll('li[role="option"]');
  assert.equal(optionsList.length, 2, 'Should only show 2 ADM-2026 rounds');
  assert.ok(optionsList[0].textContent.includes('ADM-2026-01'));
  assert.ok(optionsList[1].textContent.includes('ADM-2026-02'));
  console.log('✓ Test 3: Typing round code filters matching rounds');

  // Test 4: Typing keyword / round title filters matching rounds
  await typeInto(searchInput, 'ซอฟต์แวร์');
  await waitTick();

  optionsList = container.querySelectorAll('li[role="option"]');
  assert.equal(optionsList.length, 1, 'Should only match software developer round');
  assert.ok(optionsList[0].textContent.includes('รับสมัครพนักงานพัฒนาซอฟต์แวร์'));
  console.log('✓ Test 4: Typing keyword in round title filters matching rounds');

  // Test 5: Typing non-matching query shows emptyText
  await typeInto(searchInput, 'NOT_FOUND_KEYWORD_XYZ');
  await waitTick();

  optionsList = container.querySelectorAll('li[role="option"]');
  assert.equal(optionsList.length, 0, 'No options should match');
  assert.ok(container.textContent.includes('ไม่พบรอบรับสมัคร'), 'Must show emptyText');
  console.log('✓ Test 5: Non-matching query displays emptyText');

  // Test 6: Selecting an option updates value and input displays selected round label
  await typeInto(searchInput, 'GEN');
  await waitTick();

  optionsList = container.querySelectorAll('li[role="option"]');
  assert.equal(optionsList.length, 1);
  await act(async () => {
    optionsList[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  });
  await waitTick();

  assert.equal(container.querySelector('#current-value')?.textContent, 'r3', 'Value should be r3');
  assert.ok(searchInput.value.includes('GEN-2026-01'), 'Input should display selected round label');
  console.log('✓ Test 6: Clicking an option selects round and displays label in search input');

  // Test 7: Clear button (X) clears value back to empty and shows placeholder
  const clearBtn = container.querySelector('button[aria-label="ล้างค่าที่เลือก"]') as HTMLButtonElement;
  assert.ok(clearBtn, 'Clear button (X) should appear when a round is selected');
  await act(async () => {
    clearBtn.dispatchEvent(new win.Event('click', { bubbles: true }));
  });
  await waitTick();

  assert.equal(container.querySelector('#current-value')?.textContent, 'empty');
  assert.equal(searchInput.value, '', 'Input should be empty');
  assert.equal(searchInput.placeholder, 'ค้นหารอบรับสมัคร...', 'Placeholder is visible');
  console.log('✓ Test 7: Clear button (X) resets round filter to empty');

  // Test 8: Keyboard navigation (ArrowDown + Enter)
  await act(async () => {
    searchInput.dispatchEvent(new win.Event('focus', { bubbles: true }));
  });
  await waitTick();

  // If closed, first ArrowDown opens it, second ArrowDown moves highlight to r1
  await act(async () => {
    searchInput.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  await waitTick();

  await act(async () => {
    searchInput.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  await waitTick();

  await act(async () => {
    // Enter selects highlighted
    searchInput.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await waitTick();

  assert.equal(container.querySelector('#current-value')?.textContent, 'r1');
  console.log('✓ Test 8: Keyboard navigation (ArrowDown / Enter) works smoothly');

  // Test 9: External clear button resets component
  const extClearBtn = container.querySelector('#external-clear') as HTMLButtonElement;
  await act(async () => {
    extClearBtn.dispatchEvent(new win.Event('click', { bubbles: true }));
  });
  await waitTick();

  assert.equal(container.querySelector('#current-value')?.textContent, 'empty');
  assert.equal(searchInput.value, '');
  console.log('✓ Test 9: External filter reset (ล้างตัวกรอง) cleans input state');

  // Test 10: Standard mode (searchFirst=false) backwards compatibility
  await act(async () => {
    root.render(React.createElement(TestWrapper, { searchFirst: false, initialValue: '' }));
  });
  await waitTick();

  const stdBtn = container.querySelector('button[type="button"]') as HTMLButtonElement;
  assert.ok(stdBtn, 'Standard mode should render button trigger');
  console.log('✓ Test 10: Standard mode backwards compatibility preserved');

  console.log('\nAll 10 tests passed successfully!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
