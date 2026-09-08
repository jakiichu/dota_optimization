import { describe, expect, it } from 'vitest';
import { parseVdf, vdfObject, vdfString } from '../../src/infrastructure/steam/vdf.parser.ts';

const LIBRARY_FOLDERS = `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"label"		""
		"apps"
		{
			"570"		"77872265207"
			"228980"		"147871673"
		}
	}
	"1"
	{
		"path"		"D:\\\\SteamLibrary"
		"apps"
		{
			"730"		"1"
		}
	}
}`;

describe('parseVdf', () => {
  it('разбирает вложенные секции библиотек', () => {
    const parsed = parseVdf(LIBRARY_FOLDERS);

    expect(vdfString(parsed, 'libraryfolders', '0', 'path')).toBe(
      'C:\\Program Files (x86)\\Steam',
    );
    expect(vdfString(parsed, 'libraryfolders', '1', 'path')).toBe('D:\\SteamLibrary');
    expect(vdfString(parsed, 'libraryfolders', '0', 'apps', '570')).toBe('77872265207');
  });

  it('возвращает null на отсутствующем пути, а не падает', () => {
    const parsed = parseVdf(LIBRARY_FOLDERS);

    expect(vdfString(parsed, 'libraryfolders', '9', 'path')).toBeNull();
    expect(vdfString(parsed, 'нет', 'такого')).toBeNull();
    expect(vdfObject(parsed, 'libraryfolders', '0', 'path')).toBeNull();
  });

  it('не путает ключи из соседних секций', () => {
    const config = `"UserLocalConfigStore"
{
	"Software"
	{
		"Valve"
		{
			"Steam"
			{
				"apps"
				{
					"570"
					{
						"LaunchOptions"		"-novid -console"
					}
					"730"
					{
						"LaunchOptions"		"-high"
					}
				}
			}
		}
	}
}`;

    const parsed = parseVdf(config);
    const apps = vdfObject(parsed, 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps');

    expect(vdfString(apps ?? {}, '570', 'LaunchOptions')).toBe('-novid -console');
    expect(vdfString(apps ?? {}, '730', 'LaunchOptions')).toBe('-high');
  });

  it('находит ключ независимо от регистра — Valve пишет их по-разному', () => {
    const parsed = parseVdf('"Root"\n{\n\t"Apps"\n\t{\n\t\t"570"\t\t"x"\n\t}\n}');

    expect(vdfString(parsed, 'root', 'apps', '570')).toBe('x');
  });

  it('пропускает комментарии', () => {
    const parsed = parseVdf('// комментарий\n"root"\n{\n\t"key"\t\t"value"\n}');

    expect(vdfString(parsed, 'root', 'key')).toBe('value');
  });
});
