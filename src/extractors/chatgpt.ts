import { CloudExtractor } from './cloud.js';

export default class ChatGPTExtractor extends CloudExtractor {
  readonly toolId = 'chatgpt' as const;
}
