-- Create syntax for 'gif'

CREATE TABLE `gif` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `url_id` varchar(255) COLLATE utf8_unicode_ci DEFAULT NULL,
  `private` tinyint(1) unsigned DEFAULT NULL,
  `ip` varchar(255) COLLATE utf8_unicode_ci DEFAULT NULL,
  `created` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2560 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
