// Example programs live in /examples as real .safar files, shared with the CLI and tests.
import airport from '../../examples/airport.safar?raw';
import branchLine from '../../examples/branch-line.safar?raw';
import errorNotInterchange from '../../examples/error-not-interchange.safar?raw';
import errorSyntax from '../../examples/error-syntax.safar?raw';
import errorTypos from '../../examples/error-typos.safar?raw';
import errorWrongLine from '../../examples/error-wrong-line.safar?raw';
import problemStatement from '../../examples/problem-statement.safar?raw';
import threeLines from '../../examples/three-lines.safar?raw';

export interface Example {
  title: string;
  source: string;
}

export const EXAMPLES: Example[] = [
  { title: 'Problem statement', source: problemStatement },
  { title: 'Old Delhi to the airport', source: airport },
  { title: 'Three lines via Mandi House', source: threeLines },
  { title: 'Branch line (Blue → Vaishali)', source: branchLine },
  { title: 'Error: station not on line', source: errorWrongLine },
  { title: 'Error: not an interchange', source: errorNotInterchange },
  { title: 'Error: typos', source: errorTypos },
  { title: 'Error: syntax', source: errorSyntax },
];
