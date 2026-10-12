import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared';

// Plain TypeScript tests (layout, translations); no Angular test bed needed.
export default mergeConfig(shared, defineConfig({}));
