import {
  ArrayMinSize,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JSONSchema } from 'class-validator-jsonschema';

// Reddit (Devvit) — v1 submits as the Postiz app account via reddit.submitPost({ runAs: 'APP' }).
// Supports self (text) or link posts only; no media/flair/comments in v1.

export class RedditDevvitSettingsDtoInner {
  @IsString()
  @MinLength(2)
  @IsDefined()
  @JSONSchema({
    description:
      'Subreddit name (without r/ prefix). The Postiz Devvit app must be installed in this subreddit.',
  })
  subreddit: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  @IsDefined()
  title: string;

  @IsString()
  @IsIn(['self', 'link'])
  @IsDefined()
  type: 'self' | 'link';

  @IsOptional()
  @IsUrl()
  @ValidateIf((o) => o.type === 'link')
  @Matches(/^https?:\/\/.+/, { message: 'Invalid URL' })
  url?: string;
}

export class RedditDevvitSettingsValueDto {
  @Type(() => RedditDevvitSettingsDtoInner)
  @IsDefined()
  @ValidateNested()
  value: RedditDevvitSettingsDtoInner;
}

export class RedditDevvitSettingsDto {
  @Type(() => RedditDevvitSettingsValueDto)
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  subreddit: RedditDevvitSettingsValueDto[];
}
