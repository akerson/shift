// Single adapter between the game UI and the simulation engine.
import * as sim from '../sim/index';
import type { SimModule } from '../sim/api';

export const engine: SimModule = sim;
