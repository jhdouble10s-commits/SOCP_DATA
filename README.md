# SOCP Data Viewer

Supabase 데이터를 조회하고 CSV로 내려받을 수 있는 순수 HTML/CSS/JavaScript 웹 앱입니다. 정적 프런트엔드와 Vercel Serverless Function(`/api/config`)으로 구성되어 있습니다.

## 로컬 실행

1. Node.js 18 이상을 설치합니다.
2. `.env.example`을 복사해 `.env.local`을 만들고 값을 입력합니다.
3. Vercel CLI로 환경변수를 읽어 로컬 개발 서버를 실행합니다.

```powershell
npm install --global vercel
vercel dev
```

브라우저에서 Vercel CLI가 표시한 로컬 URL을 엽니다. `index.html`을 파일로 직접 열면 `/api/config`가 없으므로 작동하지 않습니다.

## 환경변수

실제 값은 Git에 저장하지 않습니다. 로컬 `.env.local`과 Vercel 프로젝트 설정에 아래 두 값을 등록하세요.

| 이름 | 용도 |
| --- | --- |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_PUBLISHABLE_KEY` | 브라우저 접속용 Supabase publishable/anon 키 |

`SUPABASE_PUBLISHABLE_KEY`에는 service-role 키 또는 데이터베이스 비밀번호를 넣지 마세요. 이 값은 브라우저가 Supabase에 접속하기 위해 `/api/config`에서 전달됩니다.

## Vercel 배포

1. 이 저장소를 GitHub에 푸시합니다.
2. Vercel 대시보드에서 **Add New → Project**를 선택하고 GitHub 저장소를 Import합니다.
3. Framework Preset은 **Other**로 둡니다. Build Command와 Output Directory는 비워 둡니다. 이 프로젝트는 루트의 정적 파일을 그대로 배포합니다.
4. **Settings → Environment Variables**에서 위 환경변수 두 개를 Production(필요하면 Preview/Development도)에 추가합니다.
5. Deploy를 누릅니다.

Vercel은 `api/config.js`를 Serverless Function으로 자동 배포합니다. 별도 `vercel.json`은 필요하지 않습니다.

## 이미지 일괄 다운로드

상단의 **이미지 일괄 다운로드** 탭에서 `.xlsx`, `.xls`, `.csv` 파일을 올립니다. 첫 행은 제목으로 건너뛰며, A열은 바코드(파일명), B열은 공개 이미지 URL입니다. **ZIP으로 전체 다운로드**를 누르면 서버 프록시(`/api/image-proxy`)가 이미지를 최대 4개씩 받아 CORS 제한을 피하고, 성공한 파일과 `failed_list.csv`를 ZIP으로 만듭니다.

바코드의 앞자리 0을 보존하려면 엑셀에서 A열을 텍스트 서식으로 저장하세요. 이미 숫자로 저장되어 앞자리 0이 사라진 파일은 원본 값 자체를 복구할 수 없습니다. 로그인·IP 제한·봇 차단이 있는 이미지 서버(예: 일부 쿠팡 URL)는 프록시를 거쳐도 다운로드할 수 없습니다.

## 배포 후 확인

- 배포 URL에서 테이블을 선택해 데이터가 표시되는지 확인합니다.
- `https://<deployment-url>/api/config`가 환경변수 누락 오류를 반환하지 않는지 확인합니다.
- Supabase Dashboard의 Authentication/URL Configuration 및 RLS 정책에서 Vercel 도메인이 허용되고, publishable key에 필요한 읽기/쓰기 권한만 있는지 확인합니다.
