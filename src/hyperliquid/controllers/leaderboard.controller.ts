import { Controller, Get, Param } from '@nestjs/common';
import { LeaderboardService } from '../services/leaderboard.service';
import { LeaderboardRow } from '../types/leaderboard.type';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get(':top-trader')
  async getTopTrader(limit =10
  ): Promise<LeaderboardRow[]> {
    console.log('Get Top Trader');
    return this.leaderboardService.getTopTraders(limit);
  }
}
