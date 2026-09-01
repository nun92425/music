// Firebase 設定 (favibe用)
// 初期はダミー(匿名同期はローカルfallback)。後で正規プロジェクトを発行して差し替え。
// Firebaseコンソール → プロジェクト設定 → ウェブアプリ の firebaseConfig を貼り付けると
// 推し選択がクラス全員でリアルタイム共有されます。未設定でもローカル動作は可能。
const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};
// 例(後で差し替え):
// const firebaseConfig = {
//   apiKey: "AIzaSy...",
//   authDomain: "favibe-shared.firebaseapp.com",
//   databaseURL: "https://favibe-shared-default-rtdb.firebaseio.com",
//   projectId: "favibe-shared",
//   storageBucket: "favibe-shared.appspot.com",
//   messagingSenderId: "123456789",
//   appId: "1:123456789:web:abc"
// };

// 共有バックエンドを使わない場合でも、推し選択は localStorage 'favibe_selected_artists' に保存され端末内では動作します。
// クラス共有を有効化したい場合は上記を有効化してください。
