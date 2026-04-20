/**
 * MemoBridge — Logger utilities
 */

import chalk from 'chalk';

export const log = {
  info: (msg: string) => console.log(chalk.blue('ℹ'), msg),
  success: (msg: string) => console.log(chalk.green('✅'), msg),
  warn: (msg: string) => console.log(chalk.yellow('⚠️'), msg),
  error: (msg: string) => console.log(chalk.red('❌'), msg),
  dim: (msg: string) => console.log(chalk.dim(msg)),
  header: (msg: string) => {
    console.log('');
    console.log(chalk.bold.cyan(`  🌉 ${msg}`));
    console.log('');
  },
  table: (label: string, value: string | number) => {
    console.log(`  ${chalk.dim(label.padEnd(20))} ${chalk.white(value)}`);
  },
};
