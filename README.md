## What is this?

自分用にWebサイトを管理するためのアプリ。Pinterestのように画像とURLとタグを使ってWebサイトをブックマークすることができる。
様々なWebサイトをブックマークしていると数が多くなってしまい、URLタイトルから内容を把握することが困難になる場面で活躍。
動画サイト、ECサイトなど視覚的な情報が必要なサイトにおいて有益に機能すると思われる。（画像は自分でスクショする必要がある）

## 構成

DB: Supabase database  
Authentication: Supabase Authentication  
Storage: AWS S3  

## 注意事項

* infraディレクトリの内容はTerragruntでAWSを管理するためのPoCであり、実際には利用していないモジュール有。
* 実装の大部分はChatGPTの出力をベースに手を加えているため、コードの可読性は低い。
