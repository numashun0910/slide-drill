// Interface languages. The app writes its screens in Japanese; this module rewrites the text on the page
// into the chosen language as it appears. Keys are the Japanese source strings; {name} marks a part that
// changes (a number, a file name). Text inside SKIP elements (questions, file names, quotes) is never touched.

const LANGS = ['ja', 'en', 'ms', 'zh'];
const COL = { en: 0, ms: 1, zh: 2 };
const KEY = 'slide-drill-lang';
const SKIP = '.q,.opt-t,.exp,.src-quote,.model p,.pts,.ja,.deck-title,.ql-q,.wl-q,textarea,script,style,code,[data-noi18n]';
const HAS_JA = /[぀-ヿ一-鿿]/;

const T = [
  // shell
  ['ホーム', 'Home', 'Utama', '首页'],
  ['読み込む', 'Import', 'Import', '导入'],
  ['プラン', 'Plans', 'Pelan', '套餐'],
  ['設定', 'Settings', 'Tetapan', '设置'],
  ['読み込み中…', 'Loading…', 'Memuatkan…', '加载中…'],
  ['問題集と学習記録は、このブラウザの中にだけ保存されます。', 'Your question sets and study records are stored only in this browser.', 'Set soalan dan rekod belajar anda disimpan dalam pelayar ini sahaja.', '题集和学习记录只保存在此浏览器中。'],
  ['利用規約', 'Terms of Use', 'Terma Penggunaan', '使用条款'],
  ['プライバシーポリシー', 'Privacy Policy', 'Dasar Privasi', '隐私政策'],
  ['解約・返金について', 'Cancellation & Refunds', 'Pembatalan & Bayaran Balik', '取消与退款'],
  // labels shared across screens
  ['★★★ 最重要', '★★★ Key', '★★★ Utama', '★★★ 最重要'],
  ['★★ 重要', '★★ Important', '★★ Penting', '★★ 重要'],
  ['★ 基本', '★ Basic', '★ Asas', '★ 基础'],
  ['全問', 'All questions', 'Semua soalan', '全部题目'],
  ['まだ解いていない', 'Not answered yet', 'Belum dijawab', '尚未作答'],
  ['苦手（まだ克服していない）', 'Weak (not yet mastered)', 'Lemah (belum dikuasai)', '薄弱（尚未掌握）'],
  ['1回以上まちがえた', 'Missed once or more', 'Salah sekali atau lebih', '错过1次以上'],
  ['2回以上まちがえた', 'Missed twice or more', 'Salah dua kali atau lebih', '错过2次以上'],
  ['今日の復習', 'Due today', 'Ulang kaji hari ini', '今日复习'],
  ['苦手の復習', 'Weak-question review', 'Ulang kaji soalan lemah', '薄弱题复习'],
  ['まちがえた問題の解き直し', 'Retry of missed questions', 'Cuba semula soalan yang salah', '错题重做'],
  ['重要度順', 'By importance', 'Ikut kepentingan', '按重要度'],
  ['スライド順', 'In slide order', 'Ikut urutan slaid', '按幻灯片顺序'],
  ['シャッフル', 'Shuffle', 'Rawak', '随机'],
  ['少なめ（1枚に約1問）', 'Fewer (about 1 per slide)', 'Sedikit (kira-kira 1 setiap slaid)', '较少（每页约1题）'],
  ['標準（1枚に約2問）', 'Standard (about 2 per slide)', 'Biasa (kira-kira 2 setiap slaid)', '标准（每页约2题）'],
  ['多め（1枚に約3問）', 'More (about 3 per slide)', 'Banyak (kira-kira 3 setiap slaid)', '较多（每页约3题）'],
  ['少なめ', 'Fewer', 'Sedikit', '较少'], ['標準', 'Standard', 'Biasa', '标准'], ['多め', 'More', 'Banyak', '较多'],
  ['選択式＋記述', 'Multiple-choice + short answer', 'Aneka pilihan + jawapan pendek', '选择题＋简答题'],
  ['選択式だけ', 'Multiple-choice only', 'Aneka pilihan sahaja', '只要选择题'],
  ['記述だけ', 'Short answer only', 'Jawapan pendek sahaja', '只要简答题'],
  ['すべて', 'All', 'Semua', '全部'],
  ['選択式', 'Multiple-choice', 'Aneka pilihan', '选择题'],
  ['記述', 'Short answer', 'Jawapan pendek', '简答题'],
  ['資料と同じ', 'Same as the material', 'Sama seperti bahan', '与资料相同'],
  ['英語', 'English', 'Bahasa Inggeris', '英语'], ['日本語', 'Japanese', 'Bahasa Jepun', '日语'],
  ['中国語', 'Chinese', 'Bahasa Cina', '中文'], ['マレー語', 'Malay', 'Bahasa Melayu', '马来语'],
  ['なし', 'none', 'tiada', '无'],
  ['◎ 書けた', '◎ Got it', '◎ Betul', '◎ 答对了'],
  ['△ 一部だけ', '△ Partly', '△ Sebahagian', '△ 部分答对'],
  ['✕ 書けなかった', '✕ Missed it', '✕ Tidak dapat', '✕ 没答出'],
  // home
  ['授業スライドを入れるだけで、テスト対策の問題集に。', 'Drop in your lecture slides. Get a practice set for the exam.', 'Masukkan slaid kuliah anda. Dapatkan set latihan untuk peperiksaan.', '放入课件，就能得到备考题集。'],
  ['PDF や PowerPoint を下の枠に入れると、選択問題（MCQ）と短い記述問題を重要度順に作ります。答えるとすぐに正誤・解説・スライドの該当箇所が出て、まちがえた問題は自動で復習に回ります。', 'Put a PDF or PowerPoint in the box below and get multiple-choice (MCQ) and short-answer questions, most important first. Each answer shows right or wrong, an explanation and the slide it came from, and missed questions come back for review.', 'Letakkan PDF atau PowerPoint dalam kotak di bawah untuk mendapat soalan aneka pilihan (MCQ) dan jawapan pendek, bermula dengan yang paling penting. Setiap jawapan menunjukkan betul atau salah, penjelasan dan slaid sumbernya, dan soalan yang salah akan diulang kaji.', '把 PDF 或 PowerPoint 放进下面的框里，就会按重要度生成选择题（MCQ）和简答题。作答后立即显示对错、解析和对应的幻灯片，做错的题会自动进入复习。'],
  ['「{t}」の問題を作っています。', 'Making questions for "{t}".', 'Sedang membuat soalan untuk "{t}".', '正在为“{t}”出题。'],
  ['進み具合を見る', 'See progress', 'Lihat kemajuan', '查看进度'],
  ['ここに授業のファイルをドロップ', 'Drop your lecture files here', 'Lepaskan fail kuliah anda di sini', '把课件文件拖到这里'],
  ['またはクリックして選ぶ（PDF・PPTX・DOCX・TXT・MD・画像）。1つの授業のファイルをまとめて入れると、1つの問題集になります。', 'or click to choose (PDF, PPTX, DOCX, TXT, MD, images). Files for one class added together become one question set.', 'atau klik untuk memilih (PDF, PPTX, DOCX, TXT, MD, imej). Fail untuk satu kelas yang dimasukkan bersama menjadi satu set soalan.', '或点击选择（PDF、PPTX、DOCX、TXT、MD、图片）。把同一门课的文件一起放入，会合成一个题集。'],
  ['作り方の設定', 'Options', 'Pilihan', '生成选项'],
  ['{a} · {b} · 訳：{c} · 解説：{d}', '{a} · {b} · Translation: {c} · Explanations: {d}', '{a} · {b} · Terjemahan: {c} · Penjelasan: {d}', '{a} · {b} · 翻译：{c} · 解析：{d}'],
  ['問題集の名前', 'Name of the question set', 'Nama set soalan', '题集名称'],
  ['空欄なら最初のファイル名', 'Leave empty to use the first file name', 'Biarkan kosong untuk guna nama fail pertama', '留空则使用第一个文件名'],
  ['問題の種類', 'Question types', 'Jenis soalan', '题型'],
  ['問題の量', 'How many questions', 'Bilangan soalan', '题量'],
  ['問題文の言語', 'Language of the questions', 'Bahasa soalan', '题目语言'],
  ['問題文につける訳（複数選べます）', 'Translations shown under each question (choose any)', 'Terjemahan di bawah setiap soalan (boleh pilih lebih daripada satu)', '题目下方显示的翻译（可多选）'],
  ['解説の言語', 'Language of the explanations', 'Bahasa penjelasan', '解析语言'],
  ['いまは試験運用中のため、問題を作るには Claude の API キーが必要です。', 'This is a trial version: you need your own Claude API key to make questions.', 'Ini versi percubaan: anda perlukan kunci API Claude sendiri untuk membuat soalan.', '目前为试运行版本：出题需要你自己的 Claude API 密钥。'],
  ['API キーを入れる', 'Enter an API key', 'Masukkan kunci API', '填写 API 密钥'],
  ['問題を作る', 'Make questions', 'Buat soalan', '开始出题'],
  ['無料で {n} 問つくる', 'Make {n} questions free', 'Buat {n} soalan percuma', '免费生成 {n} 题'],
  ['あなたの問題集', 'Your question sets', 'Set soalan anda', '我的题集'],
  ['ファイルから読み込む', 'Import from a file', 'Import daripada fail', '从文件导入'],
  ['まだ問題集はありません。上の枠にファイルを入れて作るか、', 'No question sets yet. Add a file above, or', 'Belum ada set soalan. Masukkan fail di atas, atau', '还没有题集。请在上方放入文件，或者'],
  ['サンプルの問題集で使い方を試せます', 'try the sample set to see how it works', 'cuba set contoh untuk melihat cara ia berfungsi', '用示例题集体验一下'],
  ['Pro プラン：1回に {n} ファイルまでまとめて、すべてのスライドから作れます。', 'Pro: combine up to {n} files at a time and make questions from every slide.', 'Pro: gabungkan sehingga {n} fail sekali gus dan buat soalan daripada semua slaid.', 'Pro：一次最多合并 {n} 个文件，并从所有幻灯片出题。'],
  ['無料プラン：1回につき {a} ファイル、最初の {b} 問まで作れます。', 'Free plan: {a} file at a time, up to the first {b} questions.', 'Pelan percuma: {a} fail setiap kali, sehingga {b} soalan pertama.', '免费版：每次 {a} 个文件，最多生成前 {b} 题。'],
  ['Pro（RM{n}/月）ですべて作る', 'Make them all with Pro (RM{n}/month)', 'Buat semuanya dengan Pro (RM{n}/bulan)', '用 Pro（RM{n}/月）生成全部'],
  ['Pro で使えます', 'Available with Pro', 'Tersedia dengan Pro', 'Pro 可用'],
  ['1回に{n}ファイルまで', 'Up to {n} files at a time', 'Sehingga {n} fail setiap kali', '每次最多 {n} 个文件'],
  ['外す', 'Remove', 'Buang', '移除'],
  ['{n}問（選択式 {a}・記述 {b}） · {f} · 作成 {d}', '{n} questions ({a} multiple-choice, {b} short answer) · {f} · created {d}', '{n} soalan ({a} aneka pilihan, {b} jawapan pendek) · {f} · dibuat {d}', '{n} 题（选择题 {a}、简答题 {b}） · {f} · 创建于 {d}'],
  ['{n}問 · {f} · 作成 {d}', '{n} questions · {f} · created {d}', '{n} soalan · {f} · dibuat {d}', '{n} 题 · {f} · 创建于 {d}'],
  ['{n}問（選択式 {a}・記述 {b}） · {f}', '{n} questions ({a} multiple-choice, {b} short answer) · {f}', '{n} soalan ({a} aneka pilihan, {b} jawapan pendek) · {f}', '{n} 题（选择题 {a}、简答题 {b}） · {f}'],
  ['{n}問 · {f}', '{n} questions · {f}', '{n} soalan · {f}', '{n} 题 · {f}'],
  ['解いた {a} / {b}', 'Answered {a} / {b}', 'Dijawab {a} / {b}', '已答 {a} / {b}'],
  ['苦手 {n}', 'Weak {n}', 'Lemah {n}', '薄弱 {n}'],
  ['今日の復習 {n}', 'Due today {n}', 'Ulang kaji hari ini {n}', '今日复习 {n}'],
  ['最終学習 {d}', 'Last studied {d}', 'Kali terakhir belajar {d}', '上次学习 {d}'],
  // generating
  ['問題を作っています', 'Making your questions', 'Sedang membuat soalan', '正在出题'],
  ['「{t}」。終わるまでこのタブを開いたままにしてください。', '"{t}". Keep this tab open until it finishes.', '"{t}". Biarkan tab ini terbuka sehingga selesai.', '“{t}”。完成前请不要关闭此标签页。'],
  ['中止する', 'Stop', 'Berhenti', '中止'],
  ['中止しています…', 'Stopping…', 'Sedang berhenti…', '正在中止…'],
  ['ファイルを読み込み中：{f}', 'Reading file: {f}', 'Membaca fail: {f}', '正在读取文件：{f}'],
  ['{f} の問題を作成中', 'Making questions for {f}', 'Membuat soalan untuk {f}', '正在为 {f} 出题'],
  ['{a} / {b} 回目 ・ この範囲で {c} 問 ・ これまでに {d} 問', 'Part {a} of {b} · {c} questions in this part · {d} so far', 'Bahagian {a} daripada {b} · {c} soalan dalam bahagian ini · {d} setakat ini', '第 {a} / {b} 部分 · 本部分 {c} 题 · 累计 {d} 题'],
  ['1回に1〜3分ほどかかります。中止しても、それまでにできた問題は保存されます。', 'Each part takes about 1 to 3 minutes. If you stop, the questions made so far are kept.', 'Setiap bahagian mengambil masa kira-kira 1 hingga 3 minit. Jika anda berhenti, soalan yang sudah dibuat akan disimpan.', '每部分大约需要1到3分钟。即使中止，已生成的题目也会保留。'],
  ['{n}問できました', '{n} questions ready', '{n} soalan sudah siap', '已生成 {n} 题'],
  ['問題を作れませんでした', 'The questions could not be made', 'Soalan tidak dapat dibuat', '未能生成题目'],
  ['「{t}」を保存しました（選択式 {a} 問・記述 {b} 問）。費用の目安：{c}', 'Saved "{t}" ({a} multiple-choice, {b} short answer). Estimated cost: {c}', '"{t}" disimpan ({a} aneka pilihan, {b} jawapan pendek). Anggaran kos: {c}', '已保存“{t}”（选择题 {a} 题、简答题 {b} 题）。预计费用：{c}'],
  ['「{t}」を保存しました（選択式 {a} 問・記述 {b} 問）。', 'Saved "{t}" ({a} multiple-choice, {b} short answer).', '"{t}" disimpan ({a} aneka pilihan, {b} jawapan pendek).', '已保存“{t}”（选择题 {a} 题、简答题 {b} 题）。'],
  ['下の理由を確認して、もう一度試してください。', 'Check the reason below and try again.', 'Semak sebab di bawah dan cuba lagi.', '请查看下面的原因后重试。'],
  ['うまくいかなかった部分', 'What went wrong', 'Bahagian yang gagal', '未成功的部分'],
  ['できた分の問題は保存されています。', 'The questions that were made have been saved.', 'Soalan yang berjaya dibuat telah disimpan.', '已生成的题目已保存。'],
  ['無料プランで作れるのはここまでです', 'That is the limit of the free plan', 'Itulah had pelan percuma', '免费版只能生成到这里'],
  ['このファイルからは、あと約 {n} 問つくれます。', 'About {n} more questions can be made from this file.', 'Kira-kira {n} lagi soalan boleh dibuat daripada fail ini.', '这个文件还能再生成约 {n} 题。'],
  ['今回使わなかったファイル：{f}。', 'Files not used this time: {f}.', 'Fail yang tidak digunakan kali ini: {f}.', '本次未使用的文件：{f}。'],
  ['Pro にすると、複数のファイルをまとめて、すべてのスライドから問題を作れます。', 'With Pro you can combine several files and make questions from every slide.', 'Dengan Pro anda boleh menggabungkan beberapa fail dan membuat soalan daripada semua slaid.', '升级 Pro 后，可以合并多个文件，并从所有幻灯片出题。'],
  ['Pro にする（RM{n}/月）', 'Get Pro (RM{n}/month)', 'Dapatkan Pro (RM{n}/bulan)', '升级 Pro（RM{n}/月）'],
  ['1回に入れられるのは {n} ファイルまでです。使わなかったファイル：{f}。', 'You can add up to {n} files at a time. Files not used: {f}.', 'Anda boleh memasukkan sehingga {n} fail setiap kali. Fail yang tidak digunakan: {f}.', '每次最多放入 {n} 个文件。未使用的文件：{f}。'],
  ['問題集を開く', 'Open the question set', 'Buka set soalan', '打开题集'],
  ['別のファイルで作る', 'Make another set', 'Buat set lain', '用其他文件再生成'],
  ['やり直す', 'Try again', 'Cuba lagi', '重试'],
  // plans
  ['まずは無料で試せます。Pro にすると、授業のファイルをまとめて入れて、すべてのスライドから問題集を作れます。', 'Try it free first. With Pro you can add all the files for a class and make a question set from every slide.', 'Cuba secara percuma dahulu. Dengan Pro anda boleh memasukkan semua fail untuk satu kelas dan membuat set soalan daripada semua slaid.', '可以先免费试用。升级 Pro 后，可以把一门课的文件一起放入，并从所有幻灯片生成题集。'],
  ['1回につき {n} ファイル', '{n} file at a time', '{n} fail setiap kali', '每次 {n} 个文件'],
  ['1ファイルにつき最初の {n} 問', 'First {n} questions per file', '{n} soalan pertama bagi setiap fail', '每个文件前 {n} 题'],
  ['解説・出典・訳の表示', 'Explanations, sources and translations', 'Penjelasan, sumber dan terjemahan', '解析、出处和翻译'],
  ['まちがえた問題の復習', 'Review of missed questions', 'Ulang kaji soalan yang salah', '错题复习'],
  ['いまのプラン', 'Your current plan', 'Pelan semasa anda', '当前套餐'],
  ['/月', '/month', '/bulan', '/月'],
  ['1回に {n} ファイルまでまとめて1つの問題集に', 'Up to {n} files combined into one question set', 'Sehingga {n} fail digabungkan menjadi satu set soalan', '一次最多合并 {n} 个文件为一个题集'],
  ['すべてのスライドから作成（選択式＋記述）', 'Questions from every slide (multiple-choice + short answer)', 'Soalan daripada semua slaid (aneka pilihan + jawapan pendek)', '从所有幻灯片出题（选择题＋简答题）'],
  ['日本語・中文・Bahasa Melayu の訳', 'Translations in Japanese, Chinese and Malay', 'Terjemahan dalam bahasa Jepun, Cina dan Melayu', '日语、中文、马来语翻译'],
  ['いつでも解約できます', 'Cancel any time', 'Batal bila-bila masa', '可随时取消'],
  ['Pro にする', 'Get Pro', 'Dapatkan Pro', '升级 Pro'],
  ['お支払いは準備中です', 'Payment is not available yet', 'Pembayaran belum tersedia', '支付功能尚未开放'],
  ['お支払いについて', 'About payment', 'Tentang pembayaran', '关于付款'],
  ['Pro は月額 RM{n} です。解約するまで毎月自動で更新され、解約後も支払い済みの期間が終わるまで使えます。', 'Pro costs RM{n} a month. It renews automatically every month until you cancel, and after cancelling you keep it until the end of the period you paid for.', 'Pro berharga RM{n} sebulan. Ia diperbaharui secara automatik setiap bulan sehingga anda batalkan, dan selepas batal anda masih boleh menggunakannya hingga tamat tempoh yang telah dibayar.', 'Pro 每月 RM{n}。在取消之前每月自动续订，取消后仍可使用到已付费周期结束。'],
  ['対応予定の支払い方法：クレジットカード・デビットカード（毎月自動更新）。FPX（銀行）や Touch \'n Go eWallet などは準備中です。', 'Planned payment methods: credit and debit cards (automatic monthly renewal). FPX (online banking) and Touch \'n Go eWallet are being prepared.', 'Kaedah pembayaran yang dirancang: kad kredit dan debit (pembaharuan bulanan automatik). FPX (perbankan dalam talian) dan Touch \'n Go eWallet sedang disediakan.', '计划支持的付款方式：信用卡和借记卡（每月自动续订）。FPX（网上银行）和 Touch \'n Go eWallet 正在准备中。'],
  // import
  ['問題集のファイルを読み込む', 'Import a question set file', 'Import fail set soalan', '导入题集文件'],
  ['このアプリで書き出した', 'Import a', 'Import fail', '导入由本应用导出的'],
  ['ファイル（別のパソコンや友だちから受け取ったもの）を読み込みます。', 'file exported from this app (from another computer or a friend).', 'yang dieksport daripada aplikasi ini (daripada komputer lain atau rakan).', '文件（来自另一台电脑或朋友）。'],
  ['ファイルを選ぶ', 'Choose a file', 'Pilih fail', '选择文件'],
  ['Claude.ai などのチャットで作る（試験運用中だけの機能）', 'Make questions in a chat such as Claude.ai (trial version only)', 'Buat soalan dalam sembang seperti Claude.ai (versi percubaan sahaja)', '在 Claude.ai 等聊天中出题（仅限试运行版本）'],
  ['ホームの「作り方の設定」で種類・量・言語を選んでから、下のボタンで問題作成用のプロンプトをコピーします。', 'Choose the types, amount and languages under "Options" on the home screen, then copy the prompt with the button below.', 'Pilih jenis, bilangan dan bahasa di bawah "Pilihan" pada skrin utama, kemudian salin prompt dengan butang di bawah.', '先在首页的“生成选项”中选择题型、题量和语言，再用下面的按钮复制出题提示词。'],
  ['で新しいチャットを開き、スライドのファイルを添付して、プロンプトを貼り付けて送ります。', ': open a new chat, attach your slide files, paste the prompt and send it.', ': buka sembang baharu, lampirkan fail slaid anda, tampal prompt dan hantar.', '：打开新对话，附上课件文件，粘贴提示词并发送。'],
  ['返ってきた返答（JSON）をすべてコピーして、下の欄に貼り付けます。', 'Copy the whole reply (JSON) and paste it into the box below.', 'Salin keseluruhan balasan (JSON) dan tampal ke dalam kotak di bawah.', '复制完整的回复（JSON），粘贴到下面的输入框。'],
  ['プロンプトをコピー', 'Copy the prompt', 'Salin prompt', '复制提示词'],
  ['例：Front Office Topic 5', 'e.g. Front Office Topic 5', 'cth. Front Office Topic 5', '例如：Front Office Topic 5'],
  ['返ってきた JSON', 'The JSON reply', 'Balasan JSON', '返回的 JSON'],
  ['取り込む', 'Import', 'Import', '导入'],
  ['チャットの返答が途中で切れたときは「続けて」と送り、最後まで出てからまとめて貼り付けてください。', 'If the reply is cut off, send "continue" and paste everything once it is complete.', 'Jika balasan terpotong, hantar "continue" dan tampal semuanya setelah lengkap.', '如果回复中途被截断，请发送“继续”，等全部输出后再一起粘贴。'],
  // settings
  ['Claude API キー（試験運用中）', 'Claude API key (trial version)', 'Kunci API Claude (versi percubaan)', 'Claude API 密钥（试运行）'],
  ['サービスの準備が整うまでは、問題を作るのにあなた自身の API キーを使います。', 'Until the service is ready, questions are made with your own API key. Create one under "API Keys" in the', 'Sehingga perkhidmatan ini sedia, soalan dibuat dengan kunci API anda sendiri. Cipta kunci di bawah "API Keys" dalam', '在服务准备就绪之前，出题会使用你自己的 API 密钥。可在以下页面的“API Keys”中创建：'],
  ['の「API Keys」で作成できます。利用料はあなたのアカウントに請求されます。', '. Usage is billed to your account.', '. Penggunaan dicaj kepada akaun anda.', '。费用将计入你的账户。'],
  ['API キー', 'API key', 'Kunci API', 'API 密钥'],
  ['表示', 'Show', 'Tunjuk', '显示'], ['隠す', 'Hide', 'Sembunyi', '隐藏'],
  ['保存', 'Save', 'Simpan', '保存'],
  ['接続テスト', 'Test connection', 'Uji sambungan', '测试连接'],
  ['キーを削除', 'Delete key', 'Padam kunci', '删除密钥'],
  ['キーはこのブラウザ（localStorage）にだけ保存され、問題を作るときに Anthropic の API（api.anthropic.com）へ直接送られます。共用のパソコンでは、使い終わったら削除してください。', 'The key is stored only in this browser (localStorage) and sent directly to the Anthropic API (api.anthropic.com) when questions are made. On a shared computer, delete it when you finish.', 'Kunci disimpan dalam pelayar ini sahaja (localStorage) dan dihantar terus ke API Anthropic (api.anthropic.com) semasa soalan dibuat. Pada komputer kongsi, padam kunci selepas selesai.', '密钥只保存在此浏览器（localStorage）中，出题时直接发送到 Anthropic API（api.anthropic.com）。在公用电脑上使用后请删除。'],
  ['生成の設定', 'Generation settings', 'Tetapan penjanaan', '生成设置'],
  ['モデル', 'Model', 'Model', '模型'],
  ['Claude Opus 5.5（おすすめ・高品質）', 'Claude Opus 5.5 (recommended, best quality)', 'Claude Opus 5.5 (disyorkan, kualiti terbaik)', 'Claude Opus 5.5（推荐，质量最高）'],
  ['Claude Sonnet 5.5（速い・安い）', 'Claude Sonnet 5.5 (faster, cheaper)', 'Claude Sonnet 5.5 (lebih pantas, lebih murah)', 'Claude Sonnet 5.5（更快、更便宜）'],
  ['Claude Haiku 5.5（いちばん安い）', 'Claude Haiku 5.5 (cheapest)', 'Claude Haiku 5.5 (paling murah)', 'Claude Haiku 5.5（最便宜）'],
  ['考える深さ', 'Thinking depth', 'Kedalaman pemikiran', '思考深度'],
  ['深く（おすすめ・問題の質が上がる）', 'Deep (recommended, better questions)', 'Mendalam (disyorkan, soalan lebih baik)', '深入（推荐，题目质量更高）'],
  ['標準（速くて安い）', 'Standard (faster and cheaper)', 'Biasa (lebih pantas dan murah)', '标准（更快更便宜）'],
  ['料金（100万トークンあたり、入力 / 出力）：Opus 5.5 $4 / $20、Sonnet 5.5 $2 / $10、Haiku 5.5 $0.10 / $0.50。', 'Prices per million tokens (input / output): Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50.', 'Harga bagi setiap juta token (input / output): Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50.', '每百万 token 价格（输入 / 输出）：Opus 5.5 $4 / $20，Sonnet 5.5 $2 / $10，Haiku 5.5 $0.10 / $0.50。'],
  ['開発者向け', 'For developers', 'Untuk pembangun', '开发者选项'],
  ['お支払いの仕組みができるまで、Pro の動きをこのブラウザだけで試すためのスイッチです。', 'A switch for trying Pro in this browser only, until payment is available.', 'Suis untuk mencuba Pro dalam pelayar ini sahaja, sehingga pembayaran tersedia.', '在支付功能上线前，仅在此浏览器中试用 Pro 的开关。'],
  ['Pro として動かす（テスト用）', 'Run as Pro (for testing)', 'Jalankan sebagai Pro (untuk ujian)', '以 Pro 运行（测试用）'],
  ['データ', 'Data', 'Data', '数据'],
  ['問題集と学習記録は、このブラウザの中（IndexedDB）にだけ保存されています。別のパソコンで使うときは、問題集の画面から書き出して、もう一台で読み込んでください。', 'Question sets and study records are stored only in this browser (IndexedDB). To use them on another computer, export a set from its page and import it there.', 'Set soalan dan rekod belajar disimpan dalam pelayar ini sahaja (IndexedDB). Untuk menggunakannya pada komputer lain, eksport set daripada halamannya dan import di sana.', '题集和学习记录只保存在此浏览器（IndexedDB）中。要在另一台电脑上使用，请在题集页面导出，再到另一台电脑导入。'],
  ['すべての問題集と設定を消す', 'Delete all question sets and settings', 'Padam semua set soalan dan tetapan', '删除所有题集和设置'],
  ['もう一度押すと、すべて消えます', 'Press again to delete everything', 'Tekan sekali lagi untuk memadam semuanya', '再按一次将全部删除'],
  ['保存しました。', 'Saved.', 'Disimpan.', '已保存。'],
  ['キーが空です。', 'The key is empty.', 'Kunci kosong.', '密钥为空。'],
  ['キーを入力してください。', 'Enter a key first.', 'Masukkan kunci dahulu.', '请先输入密钥。'],
  ['確認しています…', 'Checking…', 'Sedang menyemak…', '正在检查…'],
  ['API キーは有効です。このモデルを使えます。', 'The API key works and can use this model.', 'Kunci API sah dan boleh menggunakan model ini.', 'API 密钥有效，可以使用此模型。'],
  ['API キーが正しくありません。設定画面でキーを確認してください。', 'The API key is not valid. Check it in Settings.', 'Kunci API tidak sah. Semak dalam Tetapan.', 'API 密钥不正确。请在设置中检查。'],
  ['利用量の上限（レート制限）に達しました。1〜2分待ってから、もう一度生成してください。', 'The rate limit was reached. Wait a minute or two and try again.', 'Had kadar telah dicapai. Tunggu seminit dua dan cuba lagi.', '已达到速率限制。请等待一两分钟后重试。'],
  ['Anthropic の API に接続できませんでした。ネット接続を確認してください。', 'Could not connect to the Anthropic API. Check your internet connection.', 'Tidak dapat menyambung ke API Anthropic. Semak sambungan internet anda.', '无法连接 Anthropic API。请检查网络连接。'],
  ['この範囲は安全上の理由で問題を作れませんでした。', 'Questions could not be made for this part for safety reasons.', 'Soalan tidak dapat dibuat untuk bahagian ini atas sebab keselamatan.', '出于安全原因，无法为这一部分出题。'],
  ['{f}：対応していない形式です（PDF / PPTX / DOCX / TXT / MD / 画像に対応）。', '{f}: this format is not supported (PDF, PPTX, DOCX, TXT, MD and images are).', '{f}: format ini tidak disokong (PDF, PPTX, DOCX, TXT, MD dan imej disokong).', '{f}：不支持此格式（支持 PDF、PPTX、DOCX、TXT、MD 和图片）。'],
  ['{f}：この形式は直接読めません。PowerPoint・Keynote・Word で PDF（または .pptx / .docx）に書き出してから入れてください。', '{f}: this format cannot be read directly. Export it as PDF (or .pptx / .docx) from PowerPoint, Keynote or Word first.', '{f}: format ini tidak boleh dibaca terus. Eksport sebagai PDF (atau .pptx / .docx) daripada PowerPoint, Keynote atau Word dahulu.', '{f}：无法直接读取此格式。请先用 PowerPoint、Keynote 或 Word 导出为 PDF（或 .pptx / .docx）。'],
  ['{f}：PDF が大きすぎます（22MB まで）。ページを分けて書き出してください。', '{f}: the PDF is too large (22 MB maximum). Export it in smaller parts.', '{f}: PDF terlalu besar (maksimum 22 MB). Eksport dalam bahagian yang lebih kecil.', '{f}：PDF 太大（上限 22MB）。请分成几部分导出。'],
  ['{f}：文字が見つかりませんでした。', '{f}: no text was found.', '{f}: tiada teks ditemui.', '{f}：未找到文字。'],
  // question set page
  ['← ホーム', '← Home', '← Utama', '← 首页'],
  ['問題', 'Questions', 'Soalan', '题目'],
  ['解いた', 'Answered', 'Dijawab', '已答'],
  ['苦手', 'Weak', 'Lemah', '薄弱'],
  ['続きから（{a} / {b}）', 'Continue ({a} / {b})', 'Sambung ({a} / {b})', '继续（{a} / {b}）'],
  ['今日の復習 {n}問', 'Due today: {n}', 'Ulang kaji hari ini: {n}', '今日复习 {n} 题'],
  ['苦手をまとめて {n}問', 'All weak questions: {n}', 'Semua soalan lemah: {n}', '薄弱题 {n} 题'],
  ['出題を選ぶ', 'Choose what to study', 'Pilih apa yang hendak dipelajari', '选择出题范围'],
  ['範囲', 'File', 'Fail', '范围'], ['形式', 'Type', 'Jenis', '题型'], ['重要度', 'Importance', 'Kepentingan', '重要度'],
  ['順番', 'Order', 'Urutan', '顺序'], ['出題', 'Questions', 'Soalan', '出题'], ['復習', 'Review', 'Ulang kaji', '复习'], ['訳', 'Translation', 'Terjemahan', '翻译'],
  ['★★★ だけ', '★★★ only', '★★★ sahaja', '只要 ★★★'],
  ['★★ 以上', '★★ and above', '★★ ke atas', '★★ 及以上'],
  ['まちがえた問題を{n}問後にもう一度出す', 'Show a missed question again {n} questions later', 'Tunjuk semula soalan yang salah selepas {n} soalan', '做错的题在 {n} 题后再出一次'],
  ['表示しない', 'Off', 'Tutup', '不显示'],
  ['この条件で始める（{n}問）', 'Start ({n} questions)', 'Mula ({n} soalan)', '开始（{n} 题）'],
  ['問題の一覧', 'All questions', 'Senarai soalan', '题目列表'],
  ['正解・まちがいの回数つき', 'with right and wrong counts', 'dengan bilangan betul dan salah', '含对错次数'],
  ['正解・まちがいの回数つき・除外 {n}問', 'with right and wrong counts · {n} hidden', 'dengan bilangan betul dan salah · {n} disembunyikan', '含对错次数 · 已排除 {n} 题'],
  ['模範解答：{x}', 'Model answer: {x}', 'Jawapan contoh: {x}', '参考答案：{x}'],
  ['正解：{x}', 'Answer: {x}', 'Jawapan: {x}', '正确答案：{x}'],
  ['除外をやめる', 'Show again', 'Tunjuk semula', '恢复显示'],
  ['この問題集は無料プランで作りました', 'This set was made on the free plan', 'Set ini dibuat dengan pelan percuma', '此题集由免费版生成'],
  ['最初の {n} 問だけが入っています。Pro にすると、同じファイルをもう一度入れて、すべてのスライドから作り直せます。', 'It holds only the first {n} questions. With Pro you can add the same file again and make questions from every slide.', 'Ia hanya mengandungi {n} soalan pertama. Dengan Pro anda boleh memasukkan fail yang sama sekali lagi dan membuat soalan daripada semua slaid.', '其中只有前 {n} 题。升级 Pro 后，可以重新放入同一个文件，从所有幻灯片重新出题。'],
  ['この問題集', 'This question set', 'Set soalan ini', '此题集'],
  ['名前を変える', 'Rename', 'Tukar nama', '重命名'],
  ['書き出す（学習記録つき）', 'Export (with study records)', 'Eksport (dengan rekod belajar)', '导出（含学习记录）'],
  ['問題だけ書き出す（友だちに渡す用）', 'Export questions only (to share)', 'Eksport soalan sahaja (untuk dikongsi)', '只导出题目（用于分享）'],
  ['学習記録をリセット', 'Reset study records', 'Set semula rekod belajar', '重置学习记录'],
  ['問題集を削除', 'Delete this set', 'Padam set ini', '删除题集'],
  ['もう一度押すとリセット', 'Press again to reset', 'Tekan sekali lagi untuk set semula', '再按一次重置'],
  ['もう一度押すと削除', 'Press again to delete', 'Tekan sekali lagi untuk padam', '再按一次删除'],
  // studying
  ['· {a} · {b}', '· {a} · {b}', '· {a} · {b}', '· {a} · {b}'],
  ['· {a}', '· {a}', '· {a}', '· {a}'],
  ['/ {n}（復習 +{m}）', '/ {n} (review +{m})', '/ {n} (ulang kaji +{m})', '/ {n}（复习 +{m}）'],
  ['正解', 'Correct', 'Betul', '正确'],
  ['まちがい', 'Missed', 'Salah', '错误'],
  ['正答率', 'Score', 'Skor', '正确率'],
  ['もう一度', 'Again', 'Sekali lagi', '再来一次'],
  ['自分の答え（書かずに頭の中で答えても大丈夫です）', 'Your answer (you can also just answer in your head)', 'Jawapan anda (boleh juga jawab dalam fikiran sahaja)', '你的答案（也可以只在心里作答）'],
  ['ここに答えを書く', 'Write your answer here', 'Tulis jawapan anda di sini', '在这里写下答案'],
  ['模範解答を見る', 'Show the model answer', 'Tunjuk jawapan contoh', '查看参考答案'],
  ['模範解答', 'Model answer', 'Jawapan contoh', '参考答案'],
  ['採点のポイント（これが入っていれば ◎）', 'What to look for (◎ if your answer has these)', 'Perkara yang dicari (◎ jika jawapan anda mengandunginya)', '评分要点（答案包含这些即为 ◎）'],
  ['不正解　正解は {l}', 'Incorrect. The answer is {l}', 'Salah. Jawapannya {l}', '错误　正确答案是 {l}'],
  ['少し後にもう一度出ます', 'This will come back shortly', 'Soalan ini akan muncul semula sebentar lagi', '稍后会再出一次'],
  ['あなたの回答', 'Your answer', 'Jawapan anda', '你的选择'],
  ['出典', 'Source', 'Sumber', '出处'],
  ['この問題を今後出さない（内容がおかしいとき）', 'Never show this question again (if something is wrong with it)', 'Jangan tunjuk soalan ini lagi (jika ada yang tidak kena)', '以后不再出这道题（内容有问题时）'],
  ['← 前へ', '← Back', '← Kembali', '← 上一题'],
  ['スキップ', 'Skip', 'Langkau', '跳过'],
  ['次の問題 →', 'Next →', 'Seterusnya →', '下一题 →'],
  ['結果を見る', 'See results', 'Lihat keputusan', '查看结果'],
  ['選択式：', 'Multiple-choice:', 'Aneka pilihan:', '选择题：'],
  ['〜', '–', '–', '～'],
  ['· 記述：', '· Short answer:', '· Jawapan pendek:', '· 简答题：'],
  ['で模範解答、', 'model answer,', 'jawapan contoh,', '查看参考答案，'],
  ['で採点 ·', 'to grade ·', 'untuk menilai ·', '评分 ·'],
  ['次へ ·', 'next ·', 'seterusnya ·', '下一题 ·'],
  ['前へ ·', 'back ·', 'kembali ·', '上一题 ·'],
  ['訳の切り替え', 'switch translation', 'tukar terjemahan', '切换翻译'],
  // results
  ['結果 · {a} · {b}', 'Results · {a} · {b}', 'Keputusan · {a} · {b}', '结果 · {a} · {b}'],
  ['結果 · {a}', 'Results · {a}', 'Keputusan · {a}', '结果 · {a}'],
  ['最初の回答で {a} / {b} 問正解', '{a} of {b} correct on the first try', '{a} daripada {b} betul pada cubaan pertama', '首次作答 {a} / {b} 题正确'],
  ['（記述は ◎ だけを正解に数えます）', '(short answers count only when marked ◎)', '(jawapan pendek dikira betul hanya jika ditanda ◎)', '（简答题只有 ◎ 才算正确）'],
  ['スキップ {n}', '{n} skipped', '{n} dilangkau', '跳过 {n} 题'],
  ['復習で {n} 問を取り返しました', '{n} recovered in review', '{n} dibetulkan semasa ulang kaji', '复习中答对 {n} 题'],
  ['ファイル', 'File', 'Fail', '文件'],
  ['まちがえた問題（{n}）', 'Missed questions ({n})', 'Soalan yang salah ({n})', '错题（{n}）'],
  ['まちがえた問題はありません。', 'No missed questions.', 'Tiada soalan yang salah.', '没有做错的题。'],
  ['同じ問題をもう一度', 'Same questions again', 'Soalan yang sama sekali lagi', '再做一遍'],
  ['苦手をまとめて（{n}問）', 'All weak questions ({n})', 'Semua soalan lemah ({n})', '薄弱题（{n} 题）'],
  ['まちがえた {n} 問を解き直す', 'Retry the {n} missed questions', 'Cuba semula {n} soalan yang salah', '重做 {n} 道错题'],
  ['問題集に戻る', 'Back to the set', 'Kembali ke set', '返回题集'],
  // messages
  ['コピーしました', 'Copied', 'Disalin', '已复制'],
  ['自動でコピーできませんでした。選択された文字をコピーしてください。', 'Could not copy automatically. Copy the selected text.', 'Tidak dapat menyalin secara automatik. Salin teks yang dipilih.', '无法自动复制。请复制选中的文字。'],
  ['保存できませんでした。ブラウザの保存容量を確認してください。', 'Could not save. Check your browser storage.', 'Tidak dapat menyimpan. Semak storan pelayar anda.', '保存失败。请检查浏览器的存储空间。'],
  ['「{t}」の問題ができました', 'Questions for "{t}" are ready', 'Soalan untuk "{t}" sudah siap', '“{t}”的题目已生成'],
  ['見る', 'View', 'Lihat', '查看'],
  ['「{t}」を読み込みました（{n}問）', 'Imported "{t}" ({n} questions)', '"{t}" diimport ({n} soalan)', '已导入“{t}”（{n} 题）'],
  ['読み込めませんでした：{m}', 'Could not import: {m}', 'Tidak dapat mengimport: {m}', '导入失败：{m}'],
  ['{n}問を取り込みました', 'Imported {n} questions', '{n} soalan diimport', '已导入 {n} 题'],
  ['モデルを変更しました', 'Model changed', 'Model ditukar', '已更改模型'],
  ['保存しました', 'Saved', 'Disimpan', '已保存'],
  ['API キーを削除しました', 'API key deleted', 'Kunci API dipadam', '已删除 API 密钥'],
  ['すべてのデータを消しました', 'All data deleted', 'Semua data dipadam', '已删除全部数据'],
  ['学習記録をリセットしました', 'Study records reset', 'Rekod belajar diset semula', '已重置学习记录'],
  ['「{t}」を削除しました', 'Deleted "{t}"', '"{t}" dipadam', '已删除“{t}”'],
  ['この問題は今後出しません', 'This question will not be shown again', 'Soalan ini tidak akan ditunjukkan lagi', '以后不再出这道题'],
  ['元に戻す', 'Undo', 'Buat asal', '撤销'],
  ['Pro として動かします（このブラウザだけ）', 'Running as Pro (this browser only)', 'Berjalan sebagai Pro (pelayar ini sahaja)', '以 Pro 运行（仅此浏览器）'],
  ['無料プランに戻しました', 'Back on the free plan', 'Kembali ke pelan percuma', '已恢复为免费版'],
  ['読み込めませんでした', 'Could not load', 'Tidak dapat dimuatkan', '加载失败'],
  ['プライベートブラウズでは保存が使えないことがあります。通常のウィンドウで開いてください。', 'Storage may be unavailable in private browsing. Open the page in a normal window.', 'Storan mungkin tidak tersedia dalam mod peribadi. Buka halaman dalam tetingkap biasa.', '无痕模式下可能无法保存。请在普通窗口中打开。'],
  // account
  ['ログイン', 'Sign in', 'Log masuk', '登录'],
  ['アカウント', 'Account', 'Akaun', '账户'],
  ['ログアウト', 'Sign out', 'Log keluar', '退出登录'],
  ['ログインする', 'Sign in', 'Log masuk', '登录'],
  ['問題を作るには、ログインが必要です（無料）。', 'Sign in to make questions (free).', 'Log masuk untuk membuat soalan (percuma).', '生成题目需要先登录（免费）。'],
  ['メールアドレスを入れると、ログイン用のリンクが届きます。パスワードは要りません。', 'Enter your email and we will send you a sign-in link. No password needed.', 'Masukkan e-mel anda dan kami akan menghantar pautan log masuk. Tiada kata laluan diperlukan.', '输入邮箱后，我们会发送登录链接。无需密码。'],
  ['メールアドレス', 'Email address', 'Alamat e-mel', '邮箱地址'],
  ['ログイン用のリンクを送る', 'Send sign-in link', 'Hantar pautan log masuk', '发送登录链接'],
  ['送信しています…', 'Sending…', 'Menghantar…', '发送中…'],
  ['メールを送りました。届いたリンクを開くとログインできます。', 'Email sent. Open the link in it to sign in.', 'E-mel telah dihantar. Buka pautan di dalamnya untuk log masuk.', '邮件已发送。打开邮件中的链接即可登录。'],
  ['メールを送れませんでした。少し待ってから、もう一度試してください。', 'Could not send the email. Wait a little and try again.', 'E-mel tidak dapat dihantar. Tunggu sebentar dan cuba lagi.', '邮件发送失败。请稍后再试。'],
  ['メールアドレスを入力してください。', 'Enter your email address.', 'Masukkan alamat e-mel anda.', '请输入邮箱地址。'],
  ['続けると、ページ下の利用規約とプライバシーポリシーに同意したことになります。', 'By continuing, you agree to the Terms of Use and Privacy Policy linked at the bottom of the page.', 'Dengan meneruskan, anda bersetuju dengan Terma Penggunaan dan Dasar Privasi di bahagian bawah halaman.', '继续即表示您同意页面底部的使用条款和隐私政策。'],
  ['ログイン中のアカウント', 'Signed in as', 'Log masuk sebagai', '当前登录账户'],
  ['いまのプラン：', 'Current plan: ', 'Pelan semasa: ', '当前套餐：'],
  ['プランを見る', 'See plans', 'Lihat pelan', '查看套餐'],
  ['無料プランは1日 {m} 回まで作れます。この24時間で {n} 回使いました。', 'The free plan allows {m} runs a day. You have used {n} in the last 24 hours.', 'Pelan percuma membenarkan {m} kali sehari. Anda telah menggunakan {n} kali dalam 24 jam lepas.', '免费套餐每天可生成 {m} 次。过去24小时已使用 {n} 次。'],
  ['1日 {n} 回まで', 'Up to {n} runs a day', 'Sehingga {n} kali sehari', '每天最多 {n} 次'],
  ['ログアウトしました', 'Signed out', 'Telah log keluar', '已退出登录'],
  ['ログインが切れました。もう一度ログインしてください。', 'Your sign-in has expired. Please sign in again.', 'Sesi log masuk anda telah tamat. Sila log masuk semula.', '登录已失效，请重新登录。'],
  ['無料プランの1日の上限に達しました。24時間たつと、また作れます。', 'You have reached the daily limit of the free plan. You can make more in 24 hours.', 'Anda telah mencapai had harian pelan percuma. Anda boleh membuat lagi selepas 24 jam.', '已达到免费套餐的每日上限。24小时后可继续生成。'],
  ['今月の Pro の利用枠を使い切りました。来月1日にもどります。', 'The Pro allowance for this month is used up. It resets on the 1st of next month.', 'Kuota Pro bulan ini telah habis. Ia dipulihkan pada 1 hb bulan depan.', '本月的 Pro 额度已用完，下月1日恢复。'],
  ['ファイルが大きすぎます。ページ数を減らすか、分けて入れてください。', 'The file is too large. Reduce the pages or split it.', 'Fail terlalu besar. Kurangkan halaman atau bahagikan fail.', '文件过大。请减少页数或拆分后上传。'],
  ['サーバーの準備がまだ終わっていません。しばらくしてから試してください。', 'The server is not ready yet. Please try again later.', 'Pelayan belum sedia. Sila cuba lagi kemudian.', '服务器尚未准备好，请稍后再试。'],
  ['サーバーの時間制限で途中で切れました。', 'The server time limit cut the run short.', 'Had masa pelayan menghentikan proses separuh jalan.', '因服务器时间限制，生成中途中断。'],
  ['サーバーでエラーが起きました。', 'A server error occurred.', 'Ralat pelayan berlaku.', '服务器发生错误。'],
  ['月に {n} 問まで', 'Up to {n} questions a month', 'Sehingga {n} soalan sebulan', '每月最多 {n} 题'],
  ['作れる量は毎月1日にもどります。使わなかった分は翌月に持ち越せません。', 'The allowance resets on the 1st of each month. Unused allowance does not carry over.', 'Kuota dipulihkan pada 1 hb setiap bulan. Baki yang tidak digunakan tidak dibawa ke bulan berikutnya.', '额度在每月1日重置，未用完的部分不会结转到下个月。'],
  ['特定商取引法に基づく表記', 'Legal notice (Japan)', 'Notis undang-undang (Jepun)', '特定商交易法标示（日本）'],
  ['カードの変更や解約は、下のボタンから Stripe の画面で行えます。解約しても、支払い済みの期間が終わるまで Pro を使えます。', 'Change your card or cancel on Stripe using the button below. After cancelling you keep Pro until the end of the period you paid for.', 'Tukar kad atau batalkan langganan di Stripe melalui butang di bawah. Selepas membatalkan, anda kekal Pro sehingga tamat tempoh yang telah dibayar.', '可通过下方按钮在 Stripe 页面更换银行卡或取消订阅。取消后，Pro 可使用至已付费周期结束。'],
  ['支払いと解約の管理', 'Manage payment and cancellation', 'Urus pembayaran dan pembatalan', '管理支付与取消'],
  ['先にログインしてください', 'Please sign in first', 'Sila log masuk dahulu', '请先登录'],
  ['お支払いの画面を開けませんでした。少し待ってから、もう一度試してください。', 'Could not open the payment page. Wait a little and try again.', 'Halaman pembayaran tidak dapat dibuka. Tunggu sebentar dan cuba lagi.', '无法打开支付页面。请稍后再试。'],
  ['資料を読んでいます…', 'Reading the material…', 'Membaca bahan…', '正在阅读资料…'],
  ['大事なポイントを選んでいます…', 'Picking the key points…', 'Memilih isi penting…', '正在挑选重点…'],
  ['問題文を書いています…', 'Writing the questions…', 'Menulis soalan…', '正在编写题目…'],
  ['選択肢を作っています…', 'Making the answer options…', 'Menyediakan pilihan jawapan…', '正在设计选项…'],
  ['解説を書いています…', 'Writing the explanations…', 'Menulis penjelasan…', '正在撰写解析…'],
  ['出典と照らし合わせています…', 'Checking against the source…', 'Menyemak dengan sumber…', '正在核对出处…'],
  ['あと少しで終わります', 'Almost done', 'Hampir siap', '即将完成'],
  ['☕ 待っていなくて大丈夫です。ほかのタブやアプリを使っていても作成は進みます。このページを閉じず、ネットにつないだままにして、あとで戻ってきてください。', '☕ No need to wait here. Questions keep being made while you use other tabs or apps. Just keep this page open and stay online, then come back later.', '☕ Tidak perlu menunggu di sini. Soalan terus dibuat walaupun anda guna tab atau aplikasi lain. Biarkan halaman ini terbuka dan kekal dalam talian, kemudian kembali semula.', '☕ 不用在这里等待。使用其他标签页或应用时，题目也会继续生成。请不要关闭本页面并保持联网，稍后再回来。'],
  ['🎟️ 招待コードを受け取りました。ログインすると Pro を無料で使えます。', '🎟️ Invite code received. Sign in to use Pro for free.', '🎟️ Kod jemputan diterima. Log masuk untuk guna Pro secara percuma.', '🎟️ 已收到邀请码。登录后即可免费使用 Pro。'],
  ['🎟️ 招待コードで Pro になりました。', '🎟️ Your invite code turned on Pro.', '🎟️ Kod jemputan anda telah mengaktifkan Pro.', '🎟️ 邀请码已为你开通 Pro。'],
  ['招待コードが正しくありませんでした。', 'The invite code was not valid.', 'Kod jemputan tidak sah.', '邀请码无效。'],
  ['招待コード', 'Invite code', 'Kod jemputan', '邀请码'],
  ['招待コードを使う', 'Use invite code', 'Guna kod jemputan', '使用邀请码'],
  ['うまくいきませんでした。もう一度試してください。', 'That did not work. Please try again.', 'Tidak berjaya. Sila cuba lagi.', '没有成功，请再试一次。'],
  ['残り 約 {n} 分', 'About {n} min left', 'Kira-kira {n} minit lagi', '大约还需 {n} 分钟'],
  ['資料が多いと数分かかります。中止しても、それまでにできた問題は保存されます。', 'Large materials take a few minutes. If you stop, the questions made so far are kept.', 'Bahan yang banyak mengambil masa beberapa minit. Jika anda berhenti, soalan yang telah dibuat tetap disimpan.', '资料较多时需要几分钟。即使中止，已生成的题目也会保留。'],
];

// Replacements inside longer text that has no entry of its own (places, small labels).
const INLINE = [
  [/スライド (\d+)/g, ['Slide $1', 'Slaid $1', '幻灯片 $1']],
  [/ページ (\d+)/g, ['Page $1', 'Halaman $1', '第 $1 页']],
  [/段落 (\d+)/g, ['Paragraph $1', 'Perenggan $1', '第 $1 段']],
  [/項目 (\d+)/g, ['Item $1', 'Perkara $1', '第 $1 项']],
  [/画像 (\d+)/g, ['Image $1', 'Imej $1', '图片 $1']],
  [/選択式 · /g, ['Multiple-choice · ', 'Aneka pilihan · ', '选择题 · ']],
  [/記述 · /g, ['Short answer · ', 'Jawapan pendek · ', '简答题 · ']],
  [/· 未回答/g, ['· not answered', '· belum dijawab', '· 未作答']],
  [/· 復習で正解/g, ['· correct in review', '· betul semasa ulang kaji', '· 复习时答对']],
  [/· 生成費用の目安 /g, ['· est. cost ', '· anggaran kos ', '· 预计费用 ']],
  [/\$0\.01 未満/g, ['under $0.01', 'bawah $0.01', '低于 $0.01']],
];

const exact = new Map(T.filter(r => !r[0].includes('{')).map(r => [r[0], r.slice(1)]));
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
const patterns = T.filter(r => r[0].includes('{')).sort((a, b) => b[0].length - a[0].length).map(r => {
  const names = [];
  const re = new RegExp('^' + r[0].split(/\{(\w+)\}/).map((part, i) => (i % 2 ? (names.push(part), '([\\s\\S]+?)') : reEsc(part))).join('') + '$');
  return { re, names, out: r.slice(1) };
});

let lang = 'ja';
try { lang = localStorage.getItem(KEY) || ''; } catch (e) { lang = ''; }
if (!LANGS.includes(lang)) {
  const nav = (navigator.language || 'en').toLowerCase();
  lang = nav.startsWith('ja') ? 'ja' : nav.startsWith('zh') ? 'zh' : nav.startsWith('ms') ? 'ms' : 'en';
}
export const currentLang = () => lang;

function translate(text) {
  const col = COL[lang];
  const core = text.trim();
  if (!core || !HAS_JA.test(core)) return text;
  const wrap = out => text.replace(core, () => out);
  const hit = exact.get(core);
  if (hit) return wrap(hit[col]);
  for (const p of patterns) {
    const m = p.re.exec(core);
    if (!m) continue;
    const vars = Object.fromEntries(p.names.map((n, i) => [n, (exact.get(m[i + 1]) || [])[col] || inline(m[i + 1], col)]));
    return wrap(p.out[col].replace(/\{(\w+)\}/g, (_, n) => vars[n]));
  }
  return wrap(inline(core, col));
}
function inline(s, col) {
  for (const [re, out] of INLINE) s = s.replace(re, out[col]);
  return s;
}

const seen = new WeakMap(); // text node -> {src, out}
const ATTRS = ['placeholder', 'aria-label', 'title'];
function doText(node) {
  const p = node.parentElement;
  if (!p || p.closest(SKIP)) return;
  let rec = seen.get(node);
  if (!rec || node.nodeValue !== rec.out) rec = { src: node.nodeValue };
  rec.out = lang === 'ja' ? rec.src : translate(rec.src);
  seen.set(node, rec);
  if (node.nodeValue !== rec.out) node.nodeValue = rec.out;
}
function doAttrs(el) {
  if (el.closest(SKIP) && !el.matches('textarea')) return;
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const key = 'i18n' + a.replace('-', '');
    if (el.dataset[key] === undefined || (el.dataset[key + 'Out'] !== el.getAttribute(a))) el.dataset[key] = el.getAttribute(a);
    const out = lang === 'ja' ? el.dataset[key] : translate(el.dataset[key]);
    el.dataset[key + 'Out'] = out;
    if (el.getAttribute(a) !== out) el.setAttribute(a, out);
  }
}
function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1) return;
  doAttrs(root);
  root.querySelectorAll('[placeholder],[aria-label],[title]').forEach(doAttrs);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) doText(n);
}

function paintButtons() {
  document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang;
  document.querySelectorAll('.langs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
}

export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try { localStorage.setItem(KEY, lang); } catch (e) {}
  paintButtons();
  walk(document.body);
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

document.addEventListener('click', e => {
  const b = e.target.closest('.langs button');
  if (b) setLang(b.dataset.lang);
});
new MutationObserver(list => {
  for (const m of list) {
    if (m.type === 'characterData') doText(m.target);
    else m.addedNodes.forEach(walk);
  }
}).observe(document.body, { childList: true, subtree: true, characterData: true });
paintButtons();
walk(document.body);
